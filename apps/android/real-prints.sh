#!/usr/bin/env bash
# Draws the app's screens with the real sheet's numbers, outside the repository, for a look before
# a release. Needs the Android SDK (the cloud setup script installs it) and the private sheet copy:
#   NEKO_REAL_SHEET=<sheet.json> [NEKO_REAL_SETTINGS=<settings.json>] apps/android/real-prints.sh <out-dir>
set -euo pipefail
out="$(realpath -m "${1:?usage: real-prints.sh <out-dir>}")"
root="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$out/views"
(cd "$root/apps/neko" && NEKO_ANDROID_VIEWS="$out/views" npx vitest run test/real-sheet.test.ts)
(cd "$root/apps/android" && NEKO_ANDROID_VIEWS="$out/views" NEKO_ANDROID_PRINTS="$out" \
  ./gradlew testDebugUnitTest --tests '*RealScreensTest' -Proborazzi.test.record=true)
echo "Prints in $out"
