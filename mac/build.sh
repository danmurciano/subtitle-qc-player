#!/bin/bash
# Builds "Subtitle QC.app" (universal: Apple Silicon + Intel, macOS 13+) and zips it.
# Runs on GitHub's Mac build machines (see .github/workflows/build.yml); also works on any Mac
# with the Xcode command-line tools.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="${VERSION:-0.1}"
BUILD="${BUILD_NUMBER:-1}"
APP="$ROOT/build/Subtitle QC.app"

rm -rf "$ROOT/build"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# 1. The interface (same single page as the web version)
(cd "$ROOT/web" && python3 build.py)
cp "$ROOT/web/dist/Subtitle_QC.html" "$APP/Contents/Resources/index.html"

# 2. The native shell, once per CPU type, then joined into one universal binary
SDK="$(xcrun --show-sdk-path --sdk macosx)"
for ARCH in arm64 x86_64; do
  xcrun swiftc -O -swift-version 5 -module-name SubtitleQC -target "$ARCH-apple-macos13.0" -sdk "$SDK" \
    "$ROOT"/mac/Sources/*.swift -o "$ROOT/build/SubtitleQC-$ARCH"
done
lipo -create "$ROOT/build/SubtitleQC-arm64" "$ROOT/build/SubtitleQC-x86_64" -output "$APP/Contents/MacOS/SubtitleQC"

# 3. Info.plist and icon
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" "$ROOT/mac/Info.plist" > "$APP/Contents/Info.plist"
ICONSET="$ROOT/build/AppIcon.iconset"
mkdir -p "$ICONSET"
cp "$ROOT"/mac/icon/icon_*.png "$ICONSET/"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# 4. Ad-hoc signature (required to run on Apple Silicon; not an Apple Developer ID)
codesign --force --deep --sign - "$APP"

# 5. Zip for download
(cd "$ROOT/build" && ditto -c -k --keepParent "Subtitle QC.app" "Subtitle-QC.zip")
echo "Built $APP ($VERSION, build $BUILD)"
