const $ = (id) => document.getElementById(id);

const SIM_POLICY_KEY = "dockSimulatedManagedPolicy";
const SIM_PLAN_KEY = "dockSimulatedPlanState";

const HCPS_SIMULATED_POLICY = {
  districtId: "hcps",
  apiBaseUrl: "https://dock-production-mvp.vercel.app",
  managedMode: true,
  allowPersonalDocks: true,
  allowSharing: true,
  environment: "pilot",
  minimumExtensionVersion: "0.3.0"
};

const HCPS_SIMULATED_PLAN = {
  plan: "district",
  status: "active",
  minExtensionVersion: "0.3.3",
  source: "local-simulation"
};

const SUSPENDED_SIM_PLAN = {
  plan: "district",
  status: "suspended",
  minExtensionVersion: "0.3.3",
  source: "local-simulation"
};

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = value == null || value === "" ? "Not set" : String(value);
}

function badge(value, tone = "neutral") {
  return `<span class="badge ${tone}">${value}</span>`;
}

function setBadge(id, value, tone = "neutral") {
  const el = $(id);
  if (!el) return;
  el.innerHTML = badge(value, tone);
}

function storageGet(area, keys) {
  return new Promise((resolve) => {
    try {
      area.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          resolve({ __error: chrome.runtime.lastError.message });
          return;
        }
        resolve(result || {});
      });
    } catch (err) {
      resolve({ __error: err?.message || String(err) });
    }
  });
}

function storageSet(area, value) {
  return new Promise((resolve) => {
    try {
      area.set(value, () => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true });
      });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

function storageRemove(area, keys) {
  return new Promise((resolve) => {
    try {
      area.remove(keys, () => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true });
      });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

function boolLabel(value) {
  if (value === true) return ["Yes", "good"];
  if (value === false) return ["No", "warn"];
  return ["Not set", "warn"];
}

function maskKey(value) {
  const raw = String(value || "");
  if (!raw) return "Not set";
  if (raw.length <= 8) return "Set";
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function fmtTime(value) {
  if (!value) return "Not available";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return new Date(n).toLocaleString();
  } catch {
    return String(value);
  }
}

function hasKeys(obj) {
  return !!obj && typeof obj === "object" && Object.keys(obj).filter(k => k !== "__error").length > 0;
}

function mergeEffectivePolicy(realManaged, simulatedManaged) {
  const realLoaded = hasKeys(realManaged);
  const simLoaded = hasKeys(simulatedManaged);

  if (realLoaded) {
    return {
      effective: realManaged,
      label: "Loaded",
      tone: "good"
    };
  }

  if (simLoaded) {
    return {
      effective: simulatedManaged,
      label: "Simulated local policy",
      tone: "warn"
    };
  }

  return {
    effective: {},
    label: "No managed policy",
    tone: "warn"
  };
}

async function enableSimulatedPolicy() {
  const result = await storageSet(chrome.storage.local, {
    [SIM_POLICY_KEY]: HCPS_SIMULATED_POLICY,
    [SIM_PLAN_KEY]: HCPS_SIMULATED_PLAN
  });

  if (!result.ok) {
    alert(`Could not enable simulated policy: ${result.error}`);
    return;
  }

  await runDiagnostics();
}

async function enableSuspendedSimulatedPolicy() {
  const result = await storageSet(chrome.storage.local, {
    [SIM_POLICY_KEY]: HCPS_SIMULATED_POLICY,
    [SIM_PLAN_KEY]: SUSPENDED_SIM_PLAN,
    dockPlanState: SUSPENDED_SIM_PLAN
  });

  if (!result.ok) {
    alert(`Could not enable suspended license test: ${result.error}`);
    return;
  }

  await runDiagnostics();
}

async function clearSimulatedPolicy() {
  const result = await storageRemove(chrome.storage.local, [
    SIM_POLICY_KEY,
    SIM_PLAN_KEY,
    "dockLicenseStatus",
    "dockPlanState",
    "dockLicenseState",
    "dockLicenseNotice"
  ]);

  if (!result.ok) {
    alert(`Could not clear simulated policy: ${result.error}`);
    return;
  }

  await runDiagnostics();
}

async function runDiagnostics() {
  const manifest = chrome.runtime.getManifest();

  setText("extensionVersion", manifest.version || "Unknown");
  setText("extensionId", chrome.runtime.id || "Unknown");
  setBadge("manifestStatus", "Loaded", "good");

  const managed = await storageGet(chrome.storage.managed, null);
  const local = await storageGet(chrome.storage.local, null);

  const realManaged = managed.__error ? {} : managed;
  const simulatedManaged = local[SIM_POLICY_KEY] || {};
  const simulatedPlan = local[SIM_PLAN_KEY] || {};
  const managedError = managed.__error;

  const effectivePolicyInfo = mergeEffectivePolicy(realManaged, simulatedManaged);
  const effective = effectivePolicyInfo.effective || {};

  setBadge(
    "managedLoaded",
    managedError ? `Managed read error: ${managedError}` : effectivePolicyInfo.label,
    managedError ? "bad" : effectivePolicyInfo.tone
  );

  const simulatedStatus = $("simulatedPolicyStatus");
  if (simulatedStatus) {
    simulatedStatus.textContent = hasKeys(simulatedManaged)
      ? JSON.stringify(simulatedManaged, null, 2)
      : "No simulated policy stored.";
  }

  setText(
    "districtId",
    effective.districtId ||
      local.dockOrg?.districtId ||
      local.dockOrg?.id ||
      "Not set"
  );

  const [managedModeText, managedModeTone] = boolLabel(effective.managedMode);
  setBadge("managedMode", managedModeText, managedModeTone);

  const [personalText, personalTone] = boolLabel(effective.allowPersonalDocks);
  setBadge("allowPersonalDocks", personalText, personalTone);

  const [sharingText, sharingTone] = boolLabel(effective.allowSharing);
  setBadge("allowSharing", sharingText, sharingTone);

  setText("apiBaseUrl", effective.apiBaseUrl || local.dockApiBaseUrl || "Not set");
  setText("licenseKey", maskKey(effective.licenseKey || local.dockLicenseKey));

  const effectiveLicenseStatus = local.dockPlanState?.status || simulatedPlan.status || local.dockLicenseStatus || "Unknown";
  const licenseTone = ["active", "trial", "grace"].includes(String(effectiveLicenseStatus).toLowerCase())
    ? "good"
    : (["past_due", "past-due"].includes(String(effectiveLicenseStatus).toLowerCase()) ? "warn" : "bad");
  setBadge("licenseStatus", effectiveLicenseStatus, licenseTone);

  setText(
    "minimumVersion",
    local.dockPlanState?.minExtensionVersion ||
      simulatedPlan.minExtensionVersion ||
      effective.minimumExtensionVersion ||
      "Not set"
  );

  const workspace = local.dockManagedWorkspace;
  const workspaceTabs = Array.isArray(workspace?.tabs) ? workspace.tabs.length : 0;
  setBadge(
    "adminWorkspace",
    workspaceTabs ? `${workspaceTabs} tabs loaded` : "Not loaded",
    workspaceTabs ? "good" : "warn"
  );

  const hasBg = !!(
    local.dockManagedMeta?.background ||
    local.dockManagedMeta?.backgroundUrl ||
    local.dockOrg?.background ||
    local.dockOrg?.backgroundUrl
  );
  setBadge("managedBackground", hasBg ? "Configured" : "Not configured", hasBg ? "good" : "warn");

  setText(
    "lastSync",
    fmtTime(local.dockManagedMeta?.syncedAt || local.dockManagedMeta?.updatedAt || local.dockLastProfileSyncDebug?.at)
  );

  const savedTabs = Array.isArray(local.savedTabs) ? local.savedTabs.length : 0;
  const savedTabsLite = Array.isArray(local.savedTabsLite) ? local.savedTabsLite.length : 0;
  setText("localMemories", `${savedTabs} savedTabs / ${savedTabsLite} lite`);

  $("rawManaged").textContent = managedError
    ? managedError
    : JSON.stringify(realManaged || {}, null, 2);
}

document.addEventListener("DOMContentLoaded", () => {
  $("refreshBtn")?.addEventListener("click", runDiagnostics);
  $("enableSimBtn")?.addEventListener("click", enableSimulatedPolicy);
  $("enableSuspendedSimBtn")?.addEventListener("click", enableSuspendedSimulatedPolicy);
  $("clearSimBtn")?.addEventListener("click", clearSimulatedPolicy);
  runDiagnostics();
});


/* LICENSE_GATE_SILENT_TRIAL_PATCH_20260823 */
