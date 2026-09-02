from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "dock-extension"
JS = EXT / "memories.js"
CSS = EXT / "memories.css"
MANIFEST = EXT / "manifest.json"
RELEASE_NOTES = EXT / "RELEASE_NOTES_v0.3.7.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FAIL {label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


js = JS.read_text(encoding="utf-8")

old_note_block = '''  const noteRow = document.createElement("div");
  noteRow.className = "dockNoteRow";
  const note = document.createElement("input");
  note.id = noteDomId;
  note.name = `dockNote-${noteDomId}`;
  note.setAttribute("aria-label", "Dock note");
  note.className = "dockNoteInput";
  note.type = "text";
  note.placeholder = opts.readOnlyNote ? "Dock" : "Note…";
  note.value = tab.reason || "";
  noteRow.appendChild(note);

  let tmr = null;
  const queueSave = () => {
    if (tmr) clearTimeout(tmr);
    tmr = setTimeout(async () => { await noteHandler(note.value); }, 350);
  };
  if (opts.readOnlyNote) {
    note.disabled = true;
    note.placeholder = opts.readOnlyPlaceholder || "Read only";
  } else {
    note.addEventListener("input", queueSave);
    note.addEventListener("blur", queueSave);
  }
'''

new_note_block = '''  const noteRow = document.createElement("div");
  noteRow.className = "dockNoteRow";

  const noteHeader = document.createElement("div");
  noteHeader.className = "dockNoteHeader";
  const noteLabel = document.createElement("label");
  noteLabel.className = "dockNoteLabel";
  noteLabel.htmlFor = noteDomId;
  noteLabel.textContent = "Notes";
  const noteStatus = document.createElement("span");
  noteStatus.className = "dockNoteStatus";
  noteStatus.textContent = opts.readOnlyNote ? "Managed" : "Saved";
  noteHeader.append(noteLabel, noteStatus);

  const note = document.createElement("textarea");
  note.id = noteDomId;
  note.name = `dockNote-${noteDomId}`;
  note.setAttribute("aria-label", "Dock notes");
  note.className = "dockNoteInput";
  note.rows = 2;
  note.maxLength = 500;
  note.spellcheck = true;
  note.placeholder = opts.readOnlyNote ? "Managed by your district" : "Add a note for future you…";
  note.value = tab.reason || "";
  noteRow.append(noteHeader, note);

  if (opts.readOnlyNote && !String(tab.reason || "").trim()) {
    noteRow.classList.add("dockNoteEmptyManaged");
  }

  const resizeNote = () => {
    if (opts.readOnlyNote) return;
    note.style.height = "auto";
    note.style.height = `${Math.min(Math.max(note.scrollHeight, 46), 116)}px`;
  };
  resizeNote();

  let tmr = null;
  let lastSavedValue = note.value;
  const persistNote = async () => {
    if (tmr) {
      clearTimeout(tmr);
      tmr = null;
    }
    if (typeof noteHandler !== "function") return;
    const nextValue = note.value.slice(0, 500);
    if (nextValue === lastSavedValue) {
      noteStatus.textContent = "Saved";
      noteStatus.dataset.state = "saved";
      return;
    }
    noteStatus.textContent = "Saving…";
    noteStatus.dataset.state = "saving";
    try {
      await noteHandler(nextValue);
      lastSavedValue = nextValue;
      noteStatus.textContent = "Saved";
      noteStatus.dataset.state = "saved";
    } catch (error) {
      console.warn("Dock note save failed", error);
      noteStatus.textContent = "Not saved";
      noteStatus.dataset.state = "error";
    }
  };
  const queueSave = () => {
    resizeNote();
    noteStatus.textContent = "Unsaved";
    noteStatus.dataset.state = "dirty";
    if (tmr) clearTimeout(tmr);
    tmr = setTimeout(persistNote, 450);
  };
  if (opts.readOnlyNote) {
    note.disabled = true;
    note.placeholder = opts.readOnlyPlaceholder || "Managed by your district";
  } else {
    note.addEventListener("input", queueSave);
    note.addEventListener("blur", persistNote);
    note.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        persistNote();
        note.blur();
      }
    });
  }
'''

js = replace_once(js, old_note_block, new_note_block, "note UI block")

old_append = '''  content.appendChild(title);
  content.appendChild(url);
  if (document.body.dataset.density !== "compact") {
    content.appendChild(meta);
    content.appendChild(noteRow);
  }
'''
new_append = '''  content.appendChild(title);
  content.appendChild(url);
  if (document.body.dataset.density !== "compact") {
    content.appendChild(meta);
  }
  content.appendChild(noteRow);
'''
js = replace_once(js, old_append, new_append, "note visibility boundary")

old_create = '''  const createCard = (t, enableNotes = false) => {
    const i = t.__index;
    const delHandler = async () => { await deleteTab(i); await load(); };
    const noteHandler = enableNotes ? async (val) => {
      const all = await getSavedTabs({ localOnly: true });
      if (!all[i]) return;
      all[i] = { ...all[i], reason: val };
      await setSavedTabs(all);
    } : null;
'''
new_create = '''  const createCard = (t) => {
    const i = t.__index;
    const delHandler = async () => { await deleteTab(i); await load(); };
    const noteHandler = async (val) => {
      const all = await getSavedTabs({ localOnly: true });
      if (!all[i]) return;
      all[i] = { ...all[i], reason: String(val || "").slice(0, 500) };
      await setSavedTabs(all);
    };
'''
js = replace_once(js, old_create, new_create, "Library note handler")

js = js.replace('firstBatch.map((t) => createCard(t, false))', 'firstBatch.map((t) => createCard(t))')
js = js.replace('chunk.map((t) => createCard(t, false))', 'chunk.map((t) => createCard(t))')
if 'createCard(t, false)' in js:
    raise SystemExit("FAIL renderAll: stale createCard(t, false) remains")

old_dead_bind = '''  firstNodes.forEach((node, idx) => {
    const t = firstBatch[idx];
    const note = node.querySelector("textarea, input.note-input, .note-input");
    if (!note) return;
    note.addEventListener("change", async (e) => {
      const i = t.__index;
      const all = await getSavedTabs({ localOnly: true });
      if (!all[i]) return;
      all[i] = { ...all[i], reason: e.target.value };
      await setSavedTabs(all);
    });
  });

'''
js = replace_once(js, old_dead_bind, '', "dead first-batch note binder")

JS.write_text(js, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
marker = "/* === Dock 0.3.7 personal memory notes restoration === */"
if marker in css:
    raise SystemExit("FAIL CSS: notes restoration block already exists")
css += '''\n\n/* === Dock 0.3.7 personal memory notes restoration === */
.dockNoteRow{
  margin-top: 10px !important;
  padding: 10px 11px 11px !important;
  border: 1px solid rgba(28,42,58,.11) !important;
  border-radius: 14px !important;
  background: linear-gradient(180deg, rgba(255,255,255,.76), rgba(251,247,242,.66)) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.65) !important;
}
.dockNoteHeader{
  display:flex !important;
  align-items:center !important;
  justify-content:space-between !important;
  gap:10px !important;
  margin-bottom:7px !important;
}
.dockNoteLabel{
  font-size:11px !important;
  line-height:1 !important;
  font-weight:900 !important;
  letter-spacing:.08em !important;
  text-transform:uppercase !important;
  color:var(--fg) !important;
  opacity:.72 !important;
}
.dockNoteStatus{
  font-size:10px !important;
  line-height:1 !important;
  font-weight:800 !important;
  color:var(--muted) !important;
  opacity:.82 !important;
}
.dockNoteStatus[data-state="saving"],
.dockNoteStatus[data-state="dirty"]{ color:#2f6f95 !important; }
.dockNoteStatus[data-state="error"]{ color:#a13b32 !important; opacity:1 !important; }
.dockNoteInput{
  display:block !important;
  width:100% !important;
  min-height:46px !important;
  max-height:116px !important;
  resize:none !important;
  overflow-y:auto !important;
  box-sizing:border-box !important;
  border:0 !important;
  border-radius:10px !important;
  background:rgba(255,255,255,.62) !important;
  padding:9px 10px !important;
  font:600 12px/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
  color:var(--fg) !important;
  outline:none !important;
  box-shadow:0 0 0 1px rgba(28,42,58,.08) inset !important;
}
.dockNoteInput::placeholder{ color:var(--muted) !important; opacity:.72 !important; }
.dockNoteInput:focus{
  background:rgba(255,255,255,.92) !important;
  box-shadow:0 0 0 2px rgba(43,140,143,.22) inset !important;
}
.dockNoteEmptyManaged{ display:none !important; }

/* Compact changes representation, not note-edit authority. */
body[data-density="compact"] .dockNoteRow{
  display:block !important;
  margin-top:6px !important;
  padding:7px 8px 8px !important;
}
body[data-density="compact"] .dockNoteHeader{ display:flex !important; margin-bottom:5px !important; }
body[data-density="compact"] .dockNoteInput{
  display:block !important;
  min-height:36px !important;
  max-height:64px !important;
  padding:7px 8px !important;
  font-size:11px !important;
}
'''
CSS.write_text(css, encoding="utf-8")

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
if manifest.get("version") != "0.3.6":
    raise SystemExit(f"FAIL manifest: expected 0.3.6, found {manifest.get('version')}")
manifest["version"] = "0.3.7"
MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

RELEASE_NOTES.write_text("""# Dock 0.3.7 — Memory Notes Restoration\n\n- Restores editable Notes on every personal Dock memory card.\n- Notes now use a clean auto-growing field with visible Saved / Saving / Unsaved status.\n- Notes remain available in Compact view instead of disappearing with layout density.\n- Existing `reason` note values are preserved; edits continue through the existing local + remote memory sync path.\n- Managed district cards remain non-editable and do not show an empty notes box.\n- No database schema change is required.\n\nCandidate status: requires real Chrome UI/persistence validation before release promotion.\n""", encoding="utf-8")

print("PASS: Dock 0.3.7 memory notes candidate patched")
