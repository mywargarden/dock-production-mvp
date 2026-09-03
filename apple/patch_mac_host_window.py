#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys

MARKER = "DOCK_MAC_HOST_WINDOW_PATCH"

HELPER = r'''

// DOCK_MAC_HOST_WINDOW_PATCH
private enum DockHostWindowController {
    static func configureAllWindows() {
        for window in NSApp.windows {
            window.styleMask.insert(.closable)
            window.styleMask.insert(.miniaturizable)

            if let close = window.standardWindowButton(.closeButton) {
                close.isHidden = false
                close.isEnabled = true
            }
            if let minimize = window.standardWindowButton(.miniaturizeButton) {
                minimize.isHidden = false
                minimize.isEnabled = true
            }
        }
    }
}
'''


def find_mac_app_delegate(root: Path) -> Path:
    candidates = list(root.rglob("AppDelegate.swift"))
    mac = [p for p in candidates if "macos" in str(p).lower()]
    if not mac:
        raise SystemExit("Could not find generated macOS AppDelegate.swift")
    mac.sort(key=lambda p: ("macos (app)" not in str(p).lower(), len(str(p))))
    return mac[0]


def inject_after_launch_method(text: str) -> tuple[str, bool]:
    pattern = re.compile(
        r"(func\s+applicationDidFinishLaunching\s*\([^)]*\)\s*\{)",
        re.MULTILINE,
    )
    match = pattern.search(text)
    if not match:
        return text, False

    injection = (
        match.group(1)
        + "\n        DispatchQueue.main.async { DockHostWindowController.configureAllWindows() }"
        + "\n        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { DockHostWindowController.configureAllWindows() }"
    )
    return text[: match.start()] + injection + text[match.end() :], True


def insert_app_delegate_method(text: str, method: str) -> str:
    class_match = re.search(
        r"class\s+AppDelegate\s*:\s*NSObject\s*,\s*NSApplicationDelegate\s*\{",
        text,
    )
    if not class_match:
        raise SystemExit("Generated macOS AppDelegate class shape was not recognized")

    depth = 0
    start = class_match.end() - 1
    for index in range(start, len(text)):
        ch = text[index]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[:index] + method + "\n" + text[index:]
    raise SystemExit("Could not locate end of generated macOS AppDelegate class")


def ensure_launch_hook(text: str) -> str:
    updated, injected = inject_after_launch_method(text)
    if injected:
        return updated

    method = r'''

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async { DockHostWindowController.configureAllWindows() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { DockHostWindowController.configureAllWindows() }
    }
'''
    return insert_app_delegate_method(text, method)


def ensure_close_does_not_quit(text: str) -> str:
    method_pattern = re.compile(
        r"func\s+applicationShouldTerminateAfterLastWindowClosed\s*\([^)]*\)\s*->\s*Bool\s*\{(?P<body>.*?)\n\s*\}",
        re.DOTALL,
    )
    match = method_pattern.search(text)
    if match:
        body = match.group("body")
        if re.search(r"\breturn\s+(true|false)\b", body):
            body = re.sub(r"\breturn\s+(true|false)\b", "return false", body, count=1)
        else:
            body = "\n        return false"
        return text[: match.start("body")] + body + text[match.end("body") :]

    method = r'''

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }
'''
    return insert_app_delegate_method(text, method)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_mac_host_window.py <generated-project-root>")

    root = Path(sys.argv[1]).expanduser().resolve()
    delegate = find_mac_app_delegate(root)
    text = delegate.read_text()

    if MARKER in text:
        print(f"Dock macOS host window patch already present: {delegate}")
        return

    if "import Cocoa" not in text and "import AppKit" not in text:
        text = "import Cocoa\n" + text

    text = ensure_launch_hook(text)
    text = ensure_close_does_not_quit(text)
    text = text.rstrip() + HELPER + "\n"
    delegate.write_text(text)

    print(f"Patched Dock macOS host window controls: {delegate}")


if __name__ == "__main__":
    main()
