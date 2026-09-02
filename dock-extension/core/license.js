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

  let mode = "active";
  let message = "Dock license is active.";

  if (expiresAt && now > expiresAt) {
    if (graceUntil && now <= graceUntil) {
      status = status === "active" ? "grace" : status;
      mode = "warning";
      message = "Dock license is in grace period.";
    } else {
      status = "expired";
      mode = "blocked";
      message = "Dock is inactive because this license has expired.";
    }
  } else if (BLOCKED_STATUSES.has(status)) {
    mode = "blocked";
    message = "Dock is inactive for this district. Please contact your district administrator or Dock support.";
  } else if (WARNING_STATUSES.has(status)) {
    mode = "warning";
    message = status === "past_due" || status === "past-due"
      ? "Dock license is past due. Access remains available during the grace window."
      : "Dock license is available with a notice.";
  }

  return {
    ok: mode !== "blocked",
    mode,
    status,
    message,
    districtId,
    source,
    expiresAt,
    graceUntil,
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
    ? await storageGet(api.storage.managed, ["districtId", "orgCode", "licenseStatus", "licenseExpiresAt", "licenseGraceUntil"])
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
  if (!state.ok) {
    const err = new Error(state.message || "Dock license is inactive.");
    err.code = "LICENSE_BLOCKED";
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
    body.dockLicenseBlocked button:not(#viewAllBtn):not(#refreshBtn),
    body.dockLicenseBlocked input,
    body.dockLicenseBlocked select,
    body.dockLicenseBlocked textarea {
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

export async function applyDockLicenseGateToPage({ page = "generic" } = {}) {
  const state = await getDockLicenseState();
  ensureBannerStyle();
  document.body.classList.toggle("dockLicenseBlocked", state.mode === "blocked");

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
    banner.className = `dockLicenseBanner ${state.mode === "blocked" ? "blocked" : "warning"}`;
    banner.textContent = state.message || "Dock license status needs attention.";
  }

  if (page === "popup") {
    setDisabled(["#saveBtn", "#saveAllBtn", "#reason", "#workspaceSelect"], state.mode === "blocked");
  } else if (page === "memories") {
    setDisabled(["#createGroupBtn", "#addBtn", "#deleteSelectedBtn", "#clearAllBtn", ".deleteBtn", ".card button.deleteBtn"], state.mode === "blocked");
  }

  return state;
}


/* LICENSE_GATE_SILENT_TRIAL_PATCH_20260823
   Active and trial licenses are intentionally silent.
   Grace and past_due warn.
   Suspended, expired, canceled, disabled, and terminated block.
*/
