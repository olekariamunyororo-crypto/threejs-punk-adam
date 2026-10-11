#!/usr/bin/env bash
# make-self-extracting.sh — build a self-extracting installer from this checkout
set -euo pipefail

OUT="${1:-threejs-conference-installer.sh}"
ROOT="$(pwd)"

if [[ ! -f "$ROOT/package.json" ]]; then
  echo "Run this from the threejs-conference repo root (package.json not found)."
  exit 1
fi

EXCLUDE=(
  --exclude='./node_modules'
  --exclude='./.git'
  --exclude='./dist'
  --exclude='./.vercel'
  --exclude='./.env'
  --exclude='./.env.*'
  --exclude='./threejs-conference-installer.sh'
  --exclude='./make-self-extracting.sh'
)

echo "[make] Packing ${ROOT} ..."
PAYLOAD=$(mktemp)
trap 'rm -f "$PAYLOAD"' EXIT

tar -czf "$PAYLOAD" "${EXCLUDE[@]}" .

echo "[make] Writing ${OUT} ..."
{
  cat << 'HEADER'
#!/usr/bin/env bash
# Self-extracting installer for threejs-conference (Threejs-Punk)
# Source: https://github.com/olekariamunyororo-crypto/threejs-conference
set -euo pipefail

DIR="${1:-threejs-conference}"
MIN_NODE=18

die() { echo "ERROR: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js >= ${MIN_NODE} is required"
command -v npm  >/dev/null 2>&1 || die "npm is required"
command -v tar  >/dev/null 2>&1 || die "tar is required"
command -v base64 >/dev/null 2>&1 || die "base64 is required"

NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
[[ "$NODE_MAJOR" -ge "$MIN_NODE" ]] || die "Node $(node -v) is too old (need >= ${MIN_NODE})"

[[ -e "$DIR" ]] && die "Directory '${DIR}' already exists — choose another name or remove it"

mkdir -p "$DIR"
echo "Extracting embedded archive into ./${DIR} ..."

# GNU base64 uses -d
sed -n '/^__ARCHIVE_BELOW__$/,$p' "$0" | tail -n +2 | base64 -d | tar -xz -C "$DIR"

cd "$DIR"
echo "Running npm install (this may take a minute) ..."
npm install

echo
echo "Done."
echo "  cd ${DIR}"
echo "  npm run dev      # Vite + HTTPS (WebGPU needs secure context)"
echo "  npm run build"
echo "  npm run preview"
exit 0

__ARCHIVE_BELOW__
HEADER

  base64 -w 76 "$PAYLOAD"
} > "$OUT"

chmod +x "$OUT"
SIZE=$(wc -c < "$OUT" | tr -d ' ')
echo "[make] Wrote ${OUT} (${SIZE} bytes ≈ $(( SIZE / 1024 / 1024 )) MB)"
echo "[make] On target:  ./${OUT} [optional-dir]"
