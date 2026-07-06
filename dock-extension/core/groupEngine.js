// Grouping helpers for memories.html UI.
// Kept intentionally small: the UI owns rendering; this module owns pure operations.

export function normalizeId(s) {
  return String(s || "").trim();
}

export function makeGroup(name) {
  const id = "g_" + Math.random().toString(36).slice(2, 9) + "_" + Date.now().toString(36);
  return { id, name: String(name || "Group").trim() || "Group", createdAt: Date.now() };
}

export function groupExists(groups, id) {
  return groups.some(g => g.id === id);
}

export function ensureActiveGroup(groups, activeGroup) {
  if (!activeGroup) return "__all__";
  if (activeGroup === "__all__") return "__all__";
  if (activeGroup === "__admin__") return "__admin__";
  return groupExists(groups, activeGroup) ? activeGroup : "__all__";
}
