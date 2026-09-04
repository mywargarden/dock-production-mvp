import { api } from "../adapters/index.js";

const OWNER_KEY = "dockPersonalOwner";
const SNAPSHOT_PREFIX = "dockPersonalSnapshot:";

const ACTIVE_PERSONAL_KEYS = [
  "savedTabs",
  "savedTabsLite",
  "dockGroups",
  "dockGroupItems",
  "dockActiveGroup",
  "dockDeletedMemoryTombstones"
];

const EMPTY_PERSONAL_STATE = Object.freeze({
  savedTabs: [],
  savedTabsLite: [],
  dockGroups: [],
  dockGroupItems: {},
  dockActiveGroup: "",
  dockDeletedMemoryTombstones: {}
});

function norm(value) {
  return String(value == null ? "" : value).trim();
}

function identityForUser(user) {
  return norm(user?.id || user?.email).toLowerCase();
}

function snapshotKey(identity) {
  return `${SNAPSHOT_PREFIX}${encodeURIComponent(norm(identity).toLowerCase())}`;
}

function normalizeState(source = {}) {
  return {
    savedTabs: Array.isArray(source.savedTabs) ? source.savedTabs : [],
    savedTabsLite: Array.isArray(source.savedTabsLite) ? source.savedTabsLite : [],
    dockGroups: Array.isArray(source.dockGroups) ? source.dockGroups : [],
    dockGroupItems: source.dockGroupItems && typeof source.dockGroupItems === "object" ? source.dockGroupItems : {},
    dockActiveGroup: norm(source.dockActiveGroup),
    dockDeletedMemoryTombstones: source.dockDeletedMemoryTombstones && typeof source.dockDeletedMemoryTombstones === "object"
      ? source.dockDeletedMemoryTombstones
      : {}
  };
}

function ownerRecord(user, identity) {
  return {
    identity,
    userId: norm(user?.id),
    email: norm(user?.email).toLowerCase(),
    updatedAt: Date.now()
  };
}

async function readActiveState(extraKeys = []) {
  const res = await api.storage.local.get([...ACTIVE_PERSONAL_KEYS, ...extraKeys]);
  return { raw: res || {}, state: normalizeState(res || {}) };
}

function snapshotRecord(identity, state) {
  return {
    version: 1,
    identity,
    savedAt: Date.now(),
    state: normalizeState(state)
  };
}

/**
 * Make the active personal Dock cache belong to `user`.
 *
 * Migration rule: when no owner marker exists, existing local personal data is
 * claimed by the first authenticated user instead of being destroyed. After an
 * owner exists, switching identities atomically archives the outgoing state and
 * restores the incoming identity's previous snapshot (or a clean state).
 */
export async function ensurePersonalIdentityScope(user) {
  const nextIdentity = identityForUser(user);
  if (!nextIdentity) return { ok: false, reason: "NO_IDENTITY" };

  const { raw, state: activeState } = await readActiveState([OWNER_KEY]);
  const currentOwner = raw?.[OWNER_KEY] && typeof raw[OWNER_KEY] === "object" ? raw[OWNER_KEY] : null;
  const currentIdentity = norm(currentOwner?.identity).toLowerCase();

  if (!currentIdentity) {
    await api.storage.local.set({ [OWNER_KEY]: ownerRecord(user, nextIdentity) });
    return { ok: true, claimedExisting: true, identity: nextIdentity };
  }

  if (currentIdentity === nextIdentity) {
    if (currentOwner?.email !== norm(user?.email).toLowerCase() || currentOwner?.userId !== norm(user?.id)) {
      await api.storage.local.set({ [OWNER_KEY]: ownerRecord(user, nextIdentity) });
    }
    return { ok: true, unchanged: true, identity: nextIdentity };
  }

  const incomingKey = snapshotKey(nextIdentity);
  const incomingRes = await api.storage.local.get([incomingKey]);
  const incomingSnapshot = incomingRes?.[incomingKey];
  const incomingState = incomingSnapshot?.state && typeof incomingSnapshot.state === "object"
    ? normalizeState(incomingSnapshot.state)
    : normalizeState(EMPTY_PERSONAL_STATE);

  await api.storage.local.set({
    [snapshotKey(currentIdentity)]: snapshotRecord(currentIdentity, activeState),
    ...incomingState,
    [OWNER_KEY]: ownerRecord(user, nextIdentity)
  });

  return {
    ok: true,
    switched: true,
    from: currentIdentity,
    to: nextIdentity,
    restoredExisting: !!incomingSnapshot
  };
}

/**
 * Hide active personal state on explicit sign-out without losing it. The next
 * sign-in for this identity restores the archived snapshot; a different user
 * receives their own snapshot or an empty personal Dock.
 */
export async function parkPersonalIdentity(user = null) {
  const { raw, state: activeState } = await readActiveState([OWNER_KEY]);
  const currentOwner = raw?.[OWNER_KEY] && typeof raw[OWNER_KEY] === "object" ? raw[OWNER_KEY] : null;
  const identity = norm(currentOwner?.identity || identityForUser(user)).toLowerCase();

  const patch = {
    ...normalizeState(EMPTY_PERSONAL_STATE),
    [OWNER_KEY]: null
  };

  if (identity) {
    patch[snapshotKey(identity)] = snapshotRecord(identity, activeState);
  }

  await api.storage.local.set(patch);
  return { ok: true, parked: !!identity, identity };
}

export function getPersonalIdentity(user) {
  return identityForUser(user);
}
