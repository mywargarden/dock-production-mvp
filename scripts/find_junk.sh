#!/usr/bin/env bash
set -euo pipefail
find . \( -name '.DS_Store' -o -name '__MACOSX' -o -name '*.bak' -o -name '*.zip' -o -name 'tsconfig.tsbuildinfo' \) -print | sort
