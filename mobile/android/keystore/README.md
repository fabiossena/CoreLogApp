# Android signing keystore

This folder holds the **upload keystore** used to sign the release App Bundle.
It is deliberately empty in version control: the `.jks` and
`android/keystore.properties` are ignored by `mobile/.gitignore`.

## 1. Create the upload keystore (once)

```powershell
keytool -genkeypair -v -storetype JKS `
  -keystore corelog-upload.jks `
  -alias corelog-upload -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` ships with the JDK (Temurin 17 is enough).

## 2. Configure the passwords

```powershell
Copy-Item ../keystore.properties.example ../keystore.properties
# edit android/keystore.properties with the values chosen in step 1
```

## 3. Build the signed App Bundle

```powershell
cd android
./gradlew bundleRelease --project-cache-dir=C:\gr\corelog
# output: app/build/outputs/bundle/release/app-release.aab
```

## Important

* **Back up** the keystore and passwords in a password manager / secure vault.
  Losing the upload key means requesting a key reset from Google Play.
* Prefer **Play App Signing**: Google stores the actual signing key and this
  keystore only signs uploads.
* Do not reuse this keystore for other apps.
