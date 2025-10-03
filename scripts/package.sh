#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
DIST_DIR="${REPO_ROOT}/dist"
MANIFEST_FILE="${REPO_ROOT}/manifest.json"

BASE_NAME="ttagger"
OVERRIDE_VERSION=""
INCLUDE_DOCS=0

usage() {
  cat <<'EOF'
Usage: scripts/package.sh [options]

Create a ZIP archive containing the Chrome extension assets in the dist/ directory.

Options:
  --name NAME         Override archive base name (default: ttagger)
  --version VERSION   Override manifest version for the archive name
  --include-docs      Include Markdown docs (README, PRIVACY, DATA_SAFETY) in the archive
  -h, --help          Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      [[ $# -ge 2 ]] || { echo "Missing value for --name" >&2; exit 1; }
      BASE_NAME="$2"
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || { echo "Missing value for --version" >&2; exit 1; }
      OVERRIDE_VERSION="$2"
      shift 2
      ;;
    --include-docs)
      INCLUDE_DOCS=1
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "Cannot find manifest.json at ${MANIFEST_FILE}" >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "'zip' command not found. Please install it and re-run this script." >&2
  exit 1
fi

resolve_version() {
  if [[ -n "${OVERRIDE_VERSION}" ]]; then
    echo "${OVERRIDE_VERSION}"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY' "${MANIFEST_FILE}" || true
import json
import sys

manifest_path = sys.argv[1]
with open(manifest_path, encoding="utf-8") as handle:
    data = json.load(handle)

version = data.get("version")
if isinstance(version, str):
    print(version)
PY
  fi
}

VERSION="$(resolve_version)"

if [[ -z "${VERSION}" ]]; then
  VERSION=$(grep -oE '"version"\s*:\s*"([^"]+)"' "${MANIFEST_FILE}" | head -n 1 | sed -E 's/.*"version"\s*:\s*"([^"]+)"/\1/')
fi

if [[ -z "${VERSION}" ]]; then
  echo "Unable to determine extension version; use --version to supply it manually." >&2
  exit 1
fi

ARCHIVE_NAME="${BASE_NAME}-v${VERSION}.zip"
OUTPUT_PATH="${DIST_DIR}/${ARCHIVE_NAME}"

INCLUDE_PATHS=(
  "manifest.json"
  "_locales"
  "app"
  "assets"
  "background"
  "content"
  "options"
  "popup"
  "src"
  "styles"
)

DOC_PATHS=(
  "README.md"
  "PRIVACY.md"
  "DATA_SAFETY.md"
)

EXISTING_PATHS=()
for path in "${INCLUDE_PATHS[@]}"; do
  if [[ -e "${REPO_ROOT}/${path}" ]]; then
    EXISTING_PATHS+=("${path}")
  else
    echo "Warning: expected path '${path}' not found; skipping." >&2
  fi
done

if [[ ${INCLUDE_DOCS} -eq 1 ]]; then
  for doc in "${DOC_PATHS[@]}"; do
    if [[ -f "${REPO_ROOT}/${doc}" ]]; then
      EXISTING_PATHS+=("${doc}")
    else
      echo "Warning: requested doc '${doc}' not found; skipping." >&2
    fi
  done
fi

if [[ ${#EXISTING_PATHS[@]} -eq 0 ]]; then
  echo "Nothing to package. None of the expected files were found." >&2
  exit 1
fi

mkdir -p "${DIST_DIR}"
rm -f "${OUTPUT_PATH}"

(
  cd "${REPO_ROOT}"
  zip -r "${OUTPUT_PATH}" "${EXISTING_PATHS[@]}" \
    -x '*.DS_Store' '*/.DS_Store' '__MACOSX/*'
)

echo "Created archive: ${OUTPUT_PATH}"
