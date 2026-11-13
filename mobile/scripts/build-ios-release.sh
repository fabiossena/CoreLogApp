#!/usr/bin/env bash
# Builds, exports and (optionally) uploads the iOS app to App Store Connect.
#
# Usage (macOS):
#   APPLE_TEAM_ID=ABCDE12345 ASC_KEY_ID=... ASC_ISSUER_ID=... \
#     ./mobile/scripts/build-ios-release.sh
#
# Requirements:
#   - Xcode 16+, CocoaPods, Node 20
#   - ios/ExportOptions.plist (copy from ExportOptions.plist.example)
#   - App Store Connect API key in ~/.appstoreconnect/private_keys/AuthKey_<ID>.p8
#   - GoogleService-Info.plist added to the Xcode target when using FCM

set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$MOBILE_DIR/ios"
ARCHIVE="$IOS_DIR/build/CoreLogMobile.xcarchive"
EXPORT_DIR="$IOS_DIR/build/export"

cd "$MOBILE_DIR"
npm ci --no-audit --no-fund
cd "$IOS_DIR"
pod install

if [[ ! -f ExportOptions.plist ]]; then
  echo "Missing ios/ExportOptions.plist (copy ExportOptions.plist.example)." >&2
  exit 1
fi

xcodebuild \
  -workspace CoreLogMobile.xcworkspace \
  -scheme CoreLogMobile \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  archive

xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath "$EXPORT_DIR"

IPA="$EXPORT_DIR/CoreLogMobile.ipa"
echo "IPA ready: $IPA"

if [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]]; then
  xcrun altool --upload-app -f "$IPA" -t ios \
    --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
  echo "Uploaded to App Store Connect. Open TestFlight to add testers."
else
  echo "ASC_KEY_ID/ASC_ISSUER_ID not set; upload manually with Transporter or Xcode Organizer."
fi
