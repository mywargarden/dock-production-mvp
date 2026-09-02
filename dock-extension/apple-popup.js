// Apple-only popup authority shim.
// The shared popup UI and its normal signed-in behavior remain in popup.js.
// Safari differs only when an action must survive opening an OAuth tab, because
// Safari may tear down the action popup as soon as focus leaves it.

import { getAuthSummary, signOut } from "./core/auth.js";
import { api } from "./adapters/index.js";

const authBtn = document.getElementById("authBtn");
const saveAllBtn = document.getElementById("saveAllBtn");
const reasonInput = document.getElementById("reason");
const workspaceSelect = document.getElementById("workspaceSelect");
const progressEl = document.getElementById("progress");

function showProgress(text) {
  if (!progressEl) return;
  progressEl.textContent = text;
  progressEl.classList.remove("hidden");
}

function targetGroupId() {
  const value = workspaceSelect?.value || "__all__";
  return value === "__all__" ? "" : value;
}

async function beginDurableAuth(action, extra = {}) {
  const result = await api.runtime.sendMessage({
    type: "DOCK_SAFARI_BEGIN_AUTH",
    action,
    ...extra
  });
  if (!result?.ok) throw new Error(result?.error || "Safari sign-in could not start.");
  return result;
}

// Capture before popup.js sees the event. For Safari, Dock'em All must either
// run from the background immediately (already signed in) or hand its intent to
// the background before OAuth can destroy this popup.
saveAllBtn?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  try {
    const auth = await getAuthSummary();
    const reason = reasonInput?.value?.trim?.() || "";
    const groupId = targetGroupId();

    if (auth?.signedIn) {
      showProgress("Starting Dock'em All…");
      const result = await api.runtime.sendMessage({
        type: "SAVE_ALL_OPEN_TABS",
        reason,
        openMemories: true,
        targetGroupId: groupId
      });
      if (!result?.ok) throw new Error(result?.error || "Bulk save failed.");
      showProgress(`Done — saved ${result.saved || 0}`);
      return;
    }

    showProgress("Sign in with Google, then Dock'em All will continue automatically…");
    await beginDurableAuth("save-all", {
      reason,
      openMemories: true,
      targetGroupId: groupId
    });
  } catch (error) {
    alert(error?.message || "Dock'em All failed to start.");
  }
}, true);

// Make the explicit Sign in button durable for the same reason. Sign-out stays
// local and uses the shared auth module.
authBtn?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  try {
    const auth = await getAuthSummary();
    if (auth?.signedIn) {
      await signOut();
      authBtn.textContent = "Sign in";
      authBtn.title = "Sign in with Google";
      return;
    }

    showProgress("Opening Google sign-in…");
    await beginDurableAuth("sign-in");
  } catch (error) {
    alert(error?.message || "Google sign-in failed.");
  }
}, true);

// Load the unchanged shared popup after Safari's authority hooks are installed.
await import("./popup.js");
