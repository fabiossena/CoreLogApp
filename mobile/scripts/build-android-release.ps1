# Builds the signed Android App Bundle (AAB) for upload to Google Play.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File mobile/scripts/build-android-release.ps1
#
# Requirements:
#   - JAVA_HOME -> JDK 17
#   - ANDROID_HOME -> Android SDK (platform 35, build-tools 35.0.0, NDK 26.1.10909125)
#   - android/keystore.properties + the .jks file (see android/keystore/README.md)

$ErrorActionPreference = 'Stop'

$mobile = Split-Path -Parent $PSScriptRoot
$android = Join-Path $mobile 'android'

if (-not $env:JAVA_HOME) {
    throw 'JAVA_HOME is not set. Point it to a JDK 17 installation.'
}
if (-not $env:ANDROID_HOME) {
    throw 'ANDROID_HOME is not set. Point it to the Android SDK.'
}
if (-not (Test-Path (Join-Path $android 'keystore.properties'))) {
    throw 'android/keystore.properties not found. See android/keystore/README.md.'
}

Push-Location $android
try {
    Write-Host 'Building signed release AAB...' -ForegroundColor Cyan
    & .\gradlew.bat bundleRelease --project-cache-dir=C:\gr\corelog --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Gradle failed with exit code $LASTEXITCODE." }

    $aab = Join-Path $android 'app\build\outputs\bundle\release\app-release.aab'
    if (-not (Test-Path $aab)) { throw "AAB not found at $aab" }

    Write-Host ''
    Write-Host "AAB ready: $aab" -ForegroundColor Green
    Write-Host "Size: $([math]::Round((Get-Item $aab).Length / 1MB, 2)) MB"
    Write-Host ''
    Write-Host 'Next: Play Console -> Test and release -> Internal app sharing -> Upload new app bundle.'
} finally {
    Pop-Location
}
