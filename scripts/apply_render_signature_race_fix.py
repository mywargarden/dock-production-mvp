from pathlib import Path

path = Path("dock-extension/memories.js")
text = path.read_text()

old = '''async function load({ reason = "manual", force = false } = {}) {
  if (localLoadPromise) {
    pendingLocalLoad = true;
    return localLoadPromise;
  }
  localLoadPromise = (async () => {
    const beforeSignature = await computeRenderSignature();
    if (!force && beforeSignature === lastRenderSignature && reason !== "manual") {
      return;
    }
    await runLocalLoad();
    lastRenderSignature = await computeRenderSignature();
  })();
  try {
    return await localLoadPromise;
  } finally {
    localLoadPromise = null;
    if (pendingLocalLoad) {
      pendingLocalLoad = false;
      queueMicrotask(() => { load({ reason: "queued" }).catch(() => {}); });
    }
  }
}
'''

new = '''async function load({ reason = "manual", force = false } = {}) {
  if (localLoadPromise) {
    pendingLocalLoad = true;
    return localLoadPromise;
  }
  localLoadPromise = (async () => {
    const beforeSignature = await computeRenderSignature();
    if (!force && beforeSignature === lastRenderSignature && reason !== "manual") {
      return;
    }

    await runLocalLoad();

    // A render may only claim the storage signature it started from. If managed
    // state changes while runLocalLoad() is painting, recording the newer
    // after-state as "already rendered" can leave old DOM on screen forever:
    // the storage-change reload sees matching signatures and incorrectly skips.
    // Preserve the starting signature and queue one more pass whenever storage
    // moved during the render. The queued pass then paints the actual new state.
    lastRenderSignature = beforeSignature;
    const afterSignature = await computeRenderSignature();
    if (afterSignature !== beforeSignature) {
      pendingLocalLoad = true;
    }
  })();
  try {
    return await localLoadPromise;
  } finally {
    localLoadPromise = null;
    if (pendingLocalLoad) {
      pendingLocalLoad = false;
      queueMicrotask(() => { load({ reason: "queued" }).catch(() => {}); });
    }
  }
}
'''

count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one Safe Harbor load block, found {count}")

path.write_text(text.replace(old, new, 1))
print("Safe Harbor render signature race fix applied")
