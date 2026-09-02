from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "dock-extension"
JS = EXT / "memories.js"
CSS = EXT / "memories.css"

js = JS.read_text(encoding="utf-8")

replacements = {
    '  note.rows = 2;\n': '  note.rows = 1;\n',
    '    note.style.height = `${Math.min(Math.max(note.scrollHeight, 46), 116)}px`;\n': '    note.style.height = `${Math.min(Math.max(note.scrollHeight, 34), 68)}px`;\n',
}
for old, new in replacements.items():
    count = js.count(old)
    if count != 1:
        raise SystemExit(f"FAIL JS expected 1 match for {old!r}, found {count}")
    js = js.replace(old, new, 1)
JS.write_text(js, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
marker = "/* === Dock 0.3.7 notes compact refinement === */"
if marker in css:
    raise SystemExit("FAIL CSS refinement already exists")

css += '''\n\n/* === Dock 0.3.7 notes compact refinement === */
/* Notes are functional metadata, not a second card. Keep them visually light. */
.dockNoteRow{
  margin-top:7px !important;
  padding:0 !important;
  border:0 !important;
  border-radius:0 !important;
  background:transparent !important;
  box-shadow:none !important;
}
.dockNoteHeader{
  margin:0 2px 4px !important;
  min-height:12px !important;
}
.dockNoteLabel{
  font-size:10px !important;
  letter-spacing:.07em !important;
  opacity:.68 !important;
}
.dockNoteStatus{
  font-size:9px !important;
  opacity:.68 !important;
}
.dockNoteInput{
  min-height:34px !important;
  max-height:68px !important;
  padding:7px 8px !important;
  border:1px solid rgba(28,42,58,.12) !important;
  border-radius:8px !important;
  background:rgba(255,255,255,.68) !important;
  box-shadow:none !important;
  font-size:11px !important;
  line-height:1.3 !important;
}
.dockNoteInput:focus{
  background:rgba(255,255,255,.94) !important;
  border-color:rgba(43,140,143,.34) !important;
  box-shadow:0 0 0 2px rgba(43,140,143,.10) !important;
}
body[data-density="compact"] .dockNoteRow{
  margin-top:5px !important;
  padding:0 !important;
  border:0 !important;
  background:transparent !important;
}
body[data-density="compact"] .dockNoteHeader{
  margin:0 2px 3px !important;
}
body[data-density="compact"] .dockNoteInput{
  min-height:30px !important;
  max-height:54px !important;
  padding:6px 7px !important;
  font-size:10px !important;
}
'''
CSS.write_text(css, encoding="utf-8")

print("PASS: compact notes refinement applied")
