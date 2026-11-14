#!/usr/bin/env bash
# Runs inside a booted Android emulator (see .github/workflows/android-test.yml).
#   1. RELEASE build (R8-minified, what users install): must launch and keep running.
#   2. DEBUG build: full user journeys driven by Playwright (e2e-android/smoke.mjs).
# Screenshots, logcat and results land in $OUT. Exits non-zero on any failure.
set -uo pipefail

OUT=${OUT:-android-test}
PKG=ph.noted.app
RELEASE_APK=${RELEASE_APK:?}
DEBUG_APK=${DEBUG_APK:?}
mkdir -p "$OUT"
status=0

crashes() { grep -E "FATAL EXCEPTION|AndroidRuntime: Process: $PKG|panicked at|Fatal signal" "$1"; }

adb shell getprop ro.build.version.release | sed 's/^/Android /'
adb shell wm size
# The CI emulator is slow: its own launcher often shows "isn't responding", which
# steals focus/keys from the app under test. Hide system ANR/crash dialogs (crashes
# are still detected through logcat) and let the system settle.
adb shell settings put global hide_error_dialogs 1
adb shell input keyevent KEYCODE_HOME
sleep 20

echo "== Release build: launch"
adb install -r "$RELEASE_APK" || { echo "::error::Release APK failed to install"; exit 1; }
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null
sleep 25
adb exec-out screencap -p > "$OUT/00-release-launch.png"
if [ -z "$(adb shell pidof "$PKG" | tr -d '\r')" ]; then
  echo "::error::The release build is not running 25 s after launch (crashed?)"
  status=1
fi
adb logcat -d > "$OUT/logcat-release.txt"
if crashes "$OUT/logcat-release.txt"; then
  echo "::error::Crash found in the release build logcat"
  status=1
fi
adb uninstall "$PKG" > /dev/null

echo "== Debug build: user journeys"
# -g grants camera/microphone up front so permission prompts don't block the run.
adb install -r -g "$DEBUG_APK" || { echo "::error::Debug APK failed to install"; exit 1; }
adb logcat -c
node e2e-android/smoke.mjs "$OUT" || status=1
adb logcat -d > "$OUT/logcat-debug.txt"
if crashes "$OUT/logcat-debug.txt"; then
  echo "::error::Crash found in the debug build logcat"
  status=1
fi

exit $status
