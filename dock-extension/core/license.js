import { api } from "../adapters/index.js";

const PLAN_KEY = "dockPlanState";
const SIM_PLAN_KEY = "dockSimulatedPlanState";

const BLOCKED_STATUSES = new Set([
  "suspended",
  "inactive",
  "expired",
  "canceled",
  "cancelled",
  "disabled",
  "terminated"
]);

const WARNING_STATUSES = new Set([
  "past_due",
  "past-due",
  "grace"
]);

let lastAppliedLicenseState = null;
let mutationGuardInstalled = false;
let mutationGuardPage = "generic";
let mutationFeedbackAt = 0;
let licenseRefreshQueued = false;

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function parseTime(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseVersion(value) {
  const raw = clean(value).replace(/^v/i, "").split("-")[0];
  if (!raw) return [];
  const parts = raw.split(".").map((part) => Number(part));
  return parts.every((part) => Number.isFinite(part) && part >= 0) ? parts : [];
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a.length || !b.length) return 0;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function currentExtensionVersion() {
  try {
    return clean(api.runtime?.getManifest?.()?.version || "");
  } catch {
    return "";
  }
}

function readStatus(plan, managed) {
  const raw = clean(
    plan?.status ||
    plan?.licenseStatus ||
    managed?.licenseStatus ||
    managed?.status ||
    "active"
  ).toLowerCase();
  return raw || "active";
}

export function normalizeDockLicenseState(raw = {}) {
  const plan = raw.plan && typeof raw.plan === "object" ? raw.plan : {};
  const managed = raw.managed && typeof raw.managed === "object" ? raw.managed : {};
  const now = Date.now();

  let status = readStatus(plan, managed);
  const expiresAt = parseTime(plan.expiresAt || plan.expirationDate || managed.licenseExpiresAt || managed.expiresAt);
  const graceUntil = parseTime(plan.graceUntil || managed.licenseGraceUntil || managed.graceUntil);
  const districtId = clean(managed.districtId || managed.orgCode || plan.districtId || plan.orgCode || "");
  const source = clean(plan.source || managed.source || "local");
  const minimumExtensionVersion = clean(
    plan.minimumExtensionVersion ||
    plan.minExtensionVersion ||
    managed.minimumExtensionVersion ||
    managed.minExtensionVersion ||
    ""
  );
  const installedExtensionVersion = currentExtensionVersion();
  const updateRequired = !!(
    minimumExtensionVersion &&
    installedExtensionVersion &&
    compareVersions(installedExtensionVersion, minimumExtensionVersion) < 0
  );

  let mode = "active";
  let message = "Dock license is active.";
  let reason = "ACTIVE";

  if (expiresAt && now > expiresAt) {
    if (graceUntil && now <= graceUntil) {
      status = status === "active" ? "grace" : status;
      mode = "warning";
      reason = "LICENSE_GRACE";
      message = "Dock license is in grace period.";
    } else {
      status = "expired";
      mode = "blocked";
      reason = "LICENSE_EXPIRED";
      message = "Dock is inactive because this license has expired.";
    }
  } else if (BLOCKED_STATUSES.has(status)) {
    mode = "blocked";
    reason = "LICENSE_BLOCKED";
    message = "Dock is inactive for this district. Please contact your district administrator or Dock support.";
  } else if (updateRequired) {
    mode = "update-required";
    reason = "UPDATE_REQUIRED";
    message = `This district requires Dock ${minimumExtensionVersion} or newer. Your current Dock remains available to view, but changes are paused until Dock is updated.`;
  } else if (WARNING_STATUSES.has(status)) {
    mode = "warning";
    reason = "LICENSE_WARNING";
    message = status === "past_due" || status === "past-due"
      ? "Dock license is past due. Access remains available during the grace window."
      : "Dock license is available with a notice.";
  }

  return {
    ok: mode !== "blocked",
    mutationAllowed: mode !== "blocked" && mode !== "update-required",
    mode,
    reason,
    status,
    message,
    districtId,
    source,
    expiresAt,
    graceUntil,
    minimumExtensionVersion,
    installedExtensionVersion,
    updateRequired,
    checkedAt: now,
    rawPlan: plan
  };
}

async function storageGet(area, keys) {
  try {
    return await area.get(keys);
  } catch {
    return {};
  }
}

export async function getDockLicenseState() {
  const local = await storageGet(api.storage.local, [PLAN_KEY, SIM_PLAN_KEY, "dockLicenseStatus"]);
  const managed = api.storage?.managed?.get
    ? await storageGet(api.storage.managed, ["districtId", "orgCode", "licenseStatus", "licenseExpiresAt", "licenseGraceUntil", "minimumExtensionVersion", "minExtensionVersion"])
    : {};

  const basePlan = local[PLAN_KEY] && typeof local[PLAN_KEY] === "object" ? local[PLAN_KEY] : {};
  const simPlan = local[SIM_PLAN_KEY] && typeof local[SIM_PLAN_KEY] === "object" ? local[SIM_PLAN_KEY] : {};
  const mergedPlan = {
    ...basePlan,
    ...simPlan
  };

  if (!mergedPlan.status && local.dockLicenseStatus) mergedPlan.status = local.dockLicenseStatus;

  return normalizeDockLicenseState({ plan: mergedPlan, managed });
}

export async function ensureDockLicenseAllowed() {
  const state = await getDockLicenseState();
  if (state.mode === "blocked") {
    const err = new Error(state.message || "Dock license is inactive.");
    err.code = state.reason || "LICENSE_BLOCKED";
    err.license = state;
    throw err;
  }
  return state;
}

export async function ensureDockMutationAllowed() {
  const state = await getDockLicenseState();
  if (!state.mutationAllowed) {
    const err = new Error(state.message || "Dock changes are unavailable.");
    err.code = state.reason || "MUTATION_BLOCKED";
    err.license = state;
    throw err;
  }
  return state;
}

function ensureBannerStyle() {
  if (document.getElementById("dockLicenseGateStyle")) return;
  const style = document.createElement("style");
  style.id = "dockLicenseGateStyle";
  style.textContent = `
    .dockLicenseBanner {
      margin: 10px 12px;
      padding: 10px 12px;
      border-radius: 14px;
      font: 700 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #fff4d7;
      color: #5a3d00;
      border: 1px solid rgba(166, 118, 0, .35);
      box-shadow: 0 10px 26px rgba(20, 28, 38, .08);
      z-index: 999999;
    }
    .dockLicenseBanner.blocked {
      background: #ffe8e8;
      color: #7a1111;
      border-color: rgba(176, 38, 38, .35);
    }
    .dockLicenseBanner.updateRequired {
      background: #eaf2ff;
      color: #173f73;
      border-color: rgba(44, 103, 170, .35);
    }
    body.dockLicenseBlocked button:not(#viewAllBtn):not(#refreshBtn),
    body.dockLicenseBlocked input,
    body.dockLicenseBlocked select,
    body.dockLicenseBlocked textarea,
    body.dockUpdateRequired [data-dock-mutation="true"],
    body.dockUpdateRequired .deleteBtn,
    body.dockUpdateRequired .cardDragHandle,
    body.dockUpdateRequired .groupPillX,
    body.dockUpdateRequired .groupPillMenuItem.dangerItem,
    body.dockUpdateRequired .dockNoteInput {
      opacity: .55;
    }
  `;
  document.head.appendChild(style);
}

function setDisabled(selectors, disabled) {
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if (!node) return;
      if (node.id === "viewAllBtn" || node.id === "refreshBtn") return;
      node.disabled = !!disabled;
      if (disabled) node.setAttribute("aria-disabled", "true");
      else node.removeAttribute("aria-disabled");
    });
  });
}

function targetElement(event) {
  const raw = event?.target;
  if (!raw) return null;
  if (raw.nodeType === 1) return raw;
  return raw.parentElement || null;
}

function isMutatingGroupMenuItem(element) {
  const item = element?.closest?.(".groupPillMenuItem");
  if (!item) return false;
  const label = clean(item.textContent).toLowerCase();
  // Share is intentionally view/export behavior. The other current Dock-menu
  // operations add, edit or delete persisted state.
  return label !== "share";
}

function isMutationEventForPage(event, page) {
  const element = targetElement(event);
  if (!element) return false;

  if (page === "popup") {
    if (element.closest("#saveBtn, #saveAllBtn, #replaceBtn, .deleteBtn")) return true;
    return false;
  }

  if (page !== "memories") return !!element.closest('[data-dock-mutation="true"]');

  if (element.closest(
    "#createGroupBtn, #addBtn, #editGroupBtn, #deleteSelectedBtn, #clearAllBtn, " +
    ".deleteBtn, .groupPillX, .cardDragHandle, .dockNoteInput, [data-dock-mutation=\"true\"]"
  )) return true;

  if (isMutatingGroupMenuItem(element)) return true;

  if (event.type === "dragstart") {
    if (element.closest('.groupPillWrap[draggable="true"], .isSortable, .cardDragHandle')) return true;
  }
  if (event.type === "dragover" || event.type === "drop") {
    if (element.closest("#groupPills, #grid, .groupPillWrap, .isSortable")) return true;
  }

  return false;
}

function stopMutationEvent(event) {
  try { event.preventDefault(); } catch {}
  try { event.stopImmediatePropagation(); } catch {}
  try { event.stopPropagation(); } catch {}
}

function showMutationBlockedFeedback() {
  const now = Date.now();
  if (now - mutationFeedbackAt < 900) return;
  mutationFeedbackAt = now;
  const message = lastAppliedLicenseState?.message || "Dock changes are unavailable right now.";
  try { window.alert(message); } catch {}
}

function mutationGuardListener(event) {
  if (!lastAppliedLicenseState || lastAppliedLicenseState.mutationAllowed) return;
  if (!isMutationEventForPage(event, mutationGuardPage)) return;
  stopMutationEvent(event);

  if (["click", "pointerdown", "dragstart", "beforeinput", "paste", "drop"].includes(event.type)) {
    showMutationBlockedFeedback();
  }
}

function queueLicenseGateRefresh() {
  if (licenseRefreshQueued || typeof document === "undefined") return;
  licenseRefreshQueued = true;
  queueMicrotask(async () => {
    licenseRefreshQueued = false;
    try {
      await applyDockLicenseGateToPage({ page: mutationGuardPage });
    } catch {}
  });
}

function installMutationGuard(page) {
  mutationGuardPage = page || mutationGuardPage || "generic";
  if (mutationGuardInstalled || typeof document === "undefined") return;
  mutationGuardInstalled = true;

  ["click", "pointerdown", "dragstart", "dragover", "drop", "beforeinput", "paste", "change"].forEach((type) => {
    document.addEventListener(type, mutationGuardListener, true);
  });

  try {
    api.storage?.onChanged?.addListener?.((changes, areaName) => {
      if (areaName !== "local" && areaName !== "managed") return;
      const relevant = [
        PLAN_KEY,
        SIM_PLAN_KEY,
        "dockLicenseStatus",
        "districtId",
        "orgCode",
        "licenseStatus",
        "licenseExpiresAt",
        "licenseGraceUntil",
        "minimumExtensionVersion",
        "minExtensionVersion"
      ];
      if (relevant.some((key) => Object.prototype.hasOwnProperty.call(changes || {}, key))) {
        queueLicenseGateRefresh();
      }
    });
  } catch {}
}

export async function applyDockLicenseGateToPage({ page = "generic" } = {}) {
  mutationGuardPage = page || mutationGuardPage || "generic";
  const state = await getDockLicenseState();
  lastAppliedLicenseState = state;
  installMutationGuard(mutationGuardPage);
  ensureBannerStyle();
  document.body.classList.toggle("dockLicenseBlocked", state.mode === "blocked");
  document.body.classList.toggle("dockUpdateRequired", state.mode === "update-required");

  let banner = document.getElementById("dockLicenseBanner");
  if (state.mode === "active") {
    banner?.remove();
  } else {
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "dockLicenseBanner";
      banner.className = "dockLicenseBanner";
      const target = document.querySelector("main") || document.body;
      target.prepend(banner);
    }
    banner.className = `dockLicenseBanner ${state.mode === "blocked" ? "blocked" : state.mode === "update-required" ? "updateRequired" : "warning"}`;
    banner.textContent = state.message || "Dock license status needs attention.";
  }

  const mutationDisabled = !state.mutationAllowed;
  if (page === "popup") {
    // Keep workspace navigation and note/reason fields usable for viewing. Only
    // persisted mutation actions are disabled.
    setDisabled(["#saveBtn", "#saveAllBtn", "#replaceBtn", ".deleteBtn"], mutationDisabled);
  } else if (page === "memories") {
    setDisabled([
      "#createGroupBtn",
      "#addBtn",
      "#editGroupBtn",
      "#deleteSelectedBtn",
      "#clearAllBtn",
      ".deleteBtn",
      ".card button.deleteBtn",
      ".cardDragHandle",
      ".groupPillX",
      ".groupPillMenuItem.dangerItem",
      ".dockNoteInput"
    ], mutationDisabled);
  }

  return state;
}
