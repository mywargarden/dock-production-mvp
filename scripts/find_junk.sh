#!/usr/bin/env bash
set -euo pipefail

junk="$({ find . \( -name '.DS_Store' -o -name '__MACOSX' -o -name '*.bak' -o -name '*.zip' -o -name 'tsconfig.tsbuildinfo' \) -print || true; } | sort)"

if [[ -n "$junk" ]]; then
  echo "Repository/package junk detected:" >&2
  printf '%s\n' "$junk" >&2
  exit 1
fi

echo "No repository/package junk detected."
