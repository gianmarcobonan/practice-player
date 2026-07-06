#!/usr/bin/env bash
# Smoke test dei DMG macOS prodotti da electron-builder.
# Per ogni .dmg in dist/:
#  1) monta il DMG in modo read-only
#  2) trova il bundle .app dentro
#  3) verifica presenza di ffmpeg, yt-dlp e models/ dentro Contents/Resources
#  4) controlla che ffmpeg e l'eseguibile principale siano dell'architettura
#     attesa (dedotta dal suffisso del filename: -x64 -> x86_64, -arm64 -> arm64)
#  5) esegue ffmpeg -version e yt-dlp --version per assicurarsi che partano
#     (per il binario "cross-arch" serve Rosetta 2 installato sul runner)
# Esce con status != 0 al primo problema.

set -euo pipefail

DIST_DIR="${1:-dist}"
MOUNTED=""

cleanup() {
  if [ -n "$MOUNTED" ]; then
    hdiutil detach "$MOUNTED" -force >/dev/null 2>&1 || true
    MOUNTED=""
  fi
}
trap cleanup EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

shopt -s nullglob
dmgs=("$DIST_DIR"/*.dmg)
[ "${#dmgs[@]}" -gt 0 ] || fail "Nessun DMG in $DIST_DIR"

for dmg in "${dmgs[@]}"; do
  echo "=== $dmg ==="

  case "$dmg" in
    *-x64.dmg)   expected_arch=x86_64 ;;
    *-arm64.dmg) expected_arch=arm64 ;;
    *) fail "Non riesco a dedurre l'architettura da $dmg (atteso suffisso -x64 o -arm64)" ;;
  esac
  echo "Architettura attesa: $expected_arch"

  # hdiutil attach stampa una tabella tab-separated; l'ultima riga con /Volumes/
  # contiene il mount point come ultimo campo.
  mount_info=$(hdiutil attach -nobrowse -readonly "$dmg")
  MOUNTED=$(echo "$mount_info" | awk -F'\t' '/\/Volumes\// { mp=$NF } END { print mp }' | sed 's/[[:space:]]*$//')
  [ -n "$MOUNTED" ] || fail "Mount point non trovato"
  echo "Montato in: $MOUNTED"

  app=$(find "$MOUNTED" -maxdepth 2 -name '*.app' -print -quit)
  [ -n "$app" ] || fail "Nessun .app dentro al DMG"
  echo "Bundle: $app"

  ffmpeg="$app/Contents/Resources/bin/ffmpeg"
  ytdlp="$app/Contents/Resources/bin/yt-dlp"
  models="$app/Contents/Resources/models"
  [ -x "$ffmpeg" ] || fail "manca (o non eseguibile) $ffmpeg"
  [ -x "$ytdlp" ]  || fail "manca (o non eseguibile) $ytdlp"
  [ -d "$models" ] || fail "manca $models"

  ffmpeg_info=$(file "$ffmpeg")
  echo "ffmpeg -> $ffmpeg_info"
  echo "$ffmpeg_info" | grep -q "$expected_arch" \
    || fail "ffmpeg non e' $expected_arch"

  ytdlp_info=$(file "$ytdlp")
  echo "yt-dlp -> $ytdlp_info"

  main_exe=$(find "$app/Contents/MacOS" -type f -perm +111 -print -quit)
  [ -n "$main_exe" ] || fail "Eseguibile principale non trovato in Contents/MacOS"
  main_info=$(file "$main_exe")
  echo "main    -> $main_info"
  echo "$main_info" | grep -q "$expected_arch" \
    || fail "Eseguibile principale non e' $expected_arch"

  echo "-> ffmpeg -version"
  "$ffmpeg" -version | head -1 || fail "ffmpeg non parte (Rosetta 2 installato?)"

  echo "-> yt-dlp --version"
  "$ytdlp" --version || fail "yt-dlp non parte"

  hdiutil detach "$MOUNTED" -force
  MOUNTED=""
  echo "OK: $dmg"
  echo
done

echo "Tutti i DMG hanno passato lo smoke test."
