#!/usr/bin/env bash
# Customises the generated Android project (src-tauri/gen/android is never committed).
# Run after `npx tauri android init --ci`, before `npx tauri android build`.
set -euo pipefail

android=src-tauri/gen/android
pkg_dir="$android/app/src/main/java/ph/noted/app"

# Noted launcher icons (adaptive + legacy) from the master icon.
npx tauri icon src-tauri/icons/icon.png

# Safe-area / keyboard handling (see src-tauri/android/MainActivity.kt).
test -d "$pkg_dir" || { echo "Expected generated package dir $pkg_dir"; exit 1; }
cp src-tauri/android/MainActivity.kt "$pkg_dir/MainActivity.kt"

# Camera (document scanner, photo attachments) and microphone (voice notes): the
# WebView asks the user at runtime, but Android requires them declared here.
manifest="$android/app/src/main/AndroidManifest.xml"
for perm in CAMERA RECORD_AUDIO MODIFY_AUDIO_SETTINGS; do
  grep -q "android.permission.$perm\"" "$manifest" ||
    sed -i "s#<application#<uses-permission android:name=\"android.permission.$perm\" />\n    <application#" "$manifest"
done
# Camera hardware is optional: the app also runs on devices without one.
grep -q 'android.hardware.camera"' "$manifest" ||
  sed -i 's#<application#<uses-feature android:name="android.hardware.camera" android:required="false" />\n    <application#' "$manifest"

grep -nE 'uses-(permission|feature)' "$manifest"
