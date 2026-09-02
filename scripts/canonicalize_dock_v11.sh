#!/usr/bin/env bash
set -euo pipefail

BRANCH="canonicalize-dock-0-3-6-final"
EXPECTED_ZIP_SHA="bd4286c8a9338f690878a9f30d0edbc59bb82ea8e373c1c2f649b0057259d203"
EXPECTED_SUBTREE_SHA="d92360a241b27f2a5a4b0343ea398f26dbd945d4"
EXPECTED_VERSION="0.3.6"
EXPECTED_FILE_COUNT="66"

fail() {
  printf '\nFAIL: %s\n' "$*" >&2
  exit 1
}

hash_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    fail "Need shasum or sha256sum to verify the artifact."
  fi
}

[ "$#" -eq 1 ] || fail "Usage: $0 /path/to/dock-0.3.6-default-background-final-v11.zip"
ZIP_PATH="$1"
[ -f "$ZIP_PATH" ] || fail "ZIP not found: $ZIP_PATH"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Run this from inside the dock-production-mvp repository."
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

[ -z "$(git status --porcelain)" ] || fail "Working tree is not clean. Commit/stash unrelated work first."

ACTUAL_ZIP_SHA="$(hash_file "$ZIP_PATH")"
[ "$ACTUAL_ZIP_SHA" = "$EXPECTED_ZIP_SHA" ] || fail "ZIP SHA mismatch. Expected $EXPECTED_ZIP_SHA, got $ACTUAL_ZIP_SHA"

printf 'Artifact SHA verified: %s\n' "$ACTUAL_ZIP_SHA"

git fetch origin "$BRANCH"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git switch "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  git switch -c "$BRANCH" --track "origin/$BRANCH"
fi

[ -z "$(git status --porcelain)" ] || fail "Branch became dirty before canonicalization."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
unzip -q "$ZIP_PATH" -d "$TMP_DIR/extracted"

MANIFEST="$TMP_DIR/extracted/manifest.json"
[ -f "$MANIFEST" ] || fail "Accepted ZIP is missing manifest.json at its root."

VERSION="$(python3 - "$MANIFEST" <<'PY'
import json,sys
with open(sys.argv[1], encoding='utf-8') as f:
    print(json.load(f).get('version',''))
PY
)"
[ "$VERSION" = "$EXPECTED_VERSION" ] || fail "Manifest version mismatch. Expected $EXPECTED_VERSION, got $VERSION"

FILE_COUNT="$(find "$TMP_DIR/extracted" -type f | wc -l | tr -d ' ')"
[ "$FILE_COUNT" = "$EXPECTED_FILE_COUNT" ] || fail "File-count mismatch. Expected $EXPECTED_FILE_COUNT, got $FILE_COUNT"

printf 'Manifest/version/file-count verified: v%s / %s files\n' "$VERSION" "$FILE_COUNT"

VERIFY_DIR="$TMP_DIR/verify"
mkdir -p "$VERIFY_DIR"
cp -R "$TMP_DIR/extracted/." "$VERIFY_DIR/"
git -C "$VERIFY_DIR" init -q
git -C "$VERIFY_DIR" add -A
EXTRACTED_TREE="$(git -C "$VERIFY_DIR" write-tree)"
[ "$EXTRACTED_TREE" = "$EXPECTED_SUBTREE_SHA" ] || fail "Extracted tree mismatch. Expected $EXPECTED_SUBTREE_SHA, got $EXTRACTED_TREE"

printf 'Accepted source tree verified before copy: %s\n' "$EXTRACTED_TREE"

rm -rf dock-extension
mkdir dock-extension
cp -R "$TMP_DIR/extracted/." dock-extension/

git add -A dock-extension

OUTSIDE_CHANGES="$(git diff --cached --name-only | grep -v '^dock-extension/' || true)"
[ -z "$OUTSIDE_CHANGES" ] || fail "Unexpected staged changes outside dock-extension: $OUTSIDE_CHANGES"

ROOT_TREE="$(git write-tree)"
STAGED_SUBTREE="$(git rev-parse "$ROOT_TREE:dock-extension")"
[ "$STAGED_SUBTREE" = "$EXPECTED_SUBTREE_SHA" ] || fail "Staged dock-extension tree mismatch. Expected $EXPECTED_SUBTREE_SHA, got $STAGED_SUBTREE"

printf 'Staged dock-extension tree verified: %s\n' "$STAGED_SUBTREE"

if git diff --cached --quiet; then
  printf 'No source changes required; branch already matches accepted v11.\n'
else
  git commit -m "Canonicalize accepted Dock 0.3.6 v11 artifact"
fi

COMMIT_SHA="$(git rev-parse HEAD)"
COMMITTED_SUBTREE="$(git rev-parse HEAD:dock-extension)"
[ "$COMMITTED_SUBTREE" = "$EXPECTED_SUBTREE_SHA" ] || fail "Committed subtree mismatch."

git push origin "$BRANCH"

printf '\nPASS\n'
printf 'Branch: %s\n' "$BRANCH"
printf 'Source commit: %s\n' "$COMMIT_SHA"
printf 'dock-extension tree: %s\n' "$COMMITTED_SUBTREE"
printf 'Artifact SHA-256: %s\n' "$EXPECTED_ZIP_SHA"
printf '\nCanonical source convergence is complete only if the remote branch resolves to this same commit/tree.\n'
