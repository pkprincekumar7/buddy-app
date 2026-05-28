# BuddyApp — React Native Frontend

React Native 0.85.3 mobile app (Android & iOS).

> **Working directory convention:** Every terminal command in this file assumes your current directory is the repo root (`buddy-app/`). If you just cloned the repo, run `cd buddy-app` first and stay there.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [First-Time Setup](#first-time-setup)
- [Android](#android)
  - [One-Time Setup](#one-time-setup-android)
  - [Daily Workflow](#daily-workflow-android)
  - [When to Rebuild](#when-to-rebuild-android)
  - [Build a Debug APK](#build-a-debug-apk)
  - [Build a Release APK](#build-a-release-apk)
- [iOS](#ios)
  - [One-Time Setup](#one-time-setup-ios)
  - [Daily Workflow](#daily-workflow-ios)
  - [When to Rebuild](#when-to-rebuild-ios)
  - [Build an IPA](#build-an-ipa)
- [CI / CD (GitHub Actions)](#ci--cd-github-actions)
  - [Overview](#overview)
  - [GitHub Environment Setup](#github-environment-setup)
  - [Shared Secrets](#shared-secrets-both-android-and-ios)
  - [Android-Specific Secrets](#android-specific-secrets)
  - [Apple Developer Account](#apple-developer-account)
  - [iOS-Specific Secrets](#ios-specific-secrets)
  - [Running a Build](#running-a-build)
  - [Retrieving Build Artifacts](#retrieving-build-artifacts)
  - [AWS OIDC Setup](#aws-oidc-setup-one-time-per-aws-account)
- [Environment Variables](#environment-variables)
- [Google Sign-In Setup](#google-sign-in-setup)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Required version | Check command |
|---|---|---|
| Node.js | 18 or higher | `node --version` |
| npm | 9 or higher | `npm --version` |
| Java JDK | 17 (LTS) | `java -version` |
| Homebrew | any (macOS only) | `brew --version` |
| Android Studio | Hedgehog (2023.1) or newer | — |
| Xcode | 15 or newer (macOS only) | `xcodebuild -version` |
| CocoaPods | 1.14 or higher (macOS only) | `pod --version` |

---

## First-Time Setup

Run once after cloning the repo (from inside `buddy-app/`):

```bash
cd frontend-app
npm install
```

Create the `.env` file at `frontend-app/.env`:

```
API_URL=http://localhost:8000
GOOGLE_CLIENT_ID=
```

> **Android emulator:** `localhost:8000` works after running `adb reverse tcp:8000 tcp:8000` once per emulator boot (see Daily Workflow below).
> **iOS simulator:** `localhost:8000` works directly — no tunnel needed; the simulator shares the Mac's network stack.
> **Physical device (Android or iOS):** Replace `localhost` with your Mac's LAN IP e.g. `http://192.168.1.10:8000` and rebuild.

---

## Android

### One-Time Setup (Android)

#### Step 1 — Install Android Studio

```bash
brew install --cask android-studio
```

Or download from https://developer.android.com/studio

#### Step 2 — Configure SDK and NDK

Open Android Studio → **Tools → SDK Manager** and install:

**SDK Platforms tab:**
- Android 14.0 (API Level 34) or higher

**SDK Tools tab** (enable *Show Package Details* to see version numbers):
- Android SDK Build-Tools **36.x**
- NDK (Side by side) → **27.1.12297006** (exact version required)
- Android Emulator
- Android SDK Platform-Tools

#### Step 3 — Set Shell Environment Variables

Add to `~/.zshrc` (or `~/.bash_profile`):

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

**Java 17 is required by Gradle.** If you have multiple JDKs installed (common when Java 8 was installed earlier), pin `JAVA_HOME` explicitly:

```bash
# Find all installed JDKs
/usr/libexec/java_home -V

# Pin to Java 17 — use the path printed for your Java 17 install, e.g.:
export JAVA_HOME=/Library/Java/JavaVirtualMachines/amazon-corretto-17.jdk/Contents/Home
```

Add the `JAVA_HOME` line to `~/.zshrc` so it persists across sessions.

Reload and verify:

```bash
source ~/.zshrc
adb --version
java -version   # must print 17.x.x — if it prints 1.8 the JAVA_HOME export is missing
```

#### Step 4 — Create a Virtual Device

Android Studio → Device Manager → Create Virtual Device.

Recommended: **Pixel 7, API 34** system image.

> This app has heavy native modules (Skia, Reanimated). ABI splits are configured so the debug APK is ~60 MB (arm64-v8a only). First build takes 10–20 minutes; subsequent builds take 1–3 minutes.

#### Step 5 — First Build and Install

Start the emulator in Android Studio first, then in a terminal:

```bash
cd frontend-app/android

rm -rf app/build
./gradlew assembleDebug

adb reverse tcp:8000 tcp:8000
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

In a **separate terminal**, start Metro:

```bash
cd frontend-app
npm start
```

The app will load on the emulator.

---

### Daily Workflow (Android)

Every time you come back to work, follow these steps in order:

**Step 1 — Start the backend**
```bash
docker compose up
```

**Step 2 — Start the Android emulator**

Open Android Studio → Device Manager → click the play button on your virtual device. Wait for it to fully boot to the home screen.

**Step 3 — Set up the ADB reverse tunnel**

```bash
adb reverse tcp:8000 tcp:8000
```

This makes `localhost:8000` inside the emulator point to your Mac's `localhost:8000`. **Run this once every time the emulator starts** — without it, API calls will fail with "Network request failed".

**Step 4 — Start Metro**

```bash
cd frontend-app
npm start
```

**Step 5 — Launch the app**

The app is already installed from the previous session. Just tap its icon on the emulator, or run:

```bash
adb shell am start -n com.buddyapp/.MainActivity
```

The app connects to Metro automatically and loads.

**Step 6 — Make changes**

Edit any `.ts` / `.tsx` file and save. Metro hot-reloads instantly — no rebuild needed for JS changes. If a change doesn't appear, press `r` in the Metro terminal.

---

### When to Rebuild (Android)

| What changed | Action required |
|---|---|
| `.ts` / `.tsx` / `.js` file | Nothing — Metro hot-reloads on save |
| Change not appearing | Press `r` in the Metro terminal |
| Still not appearing after `r` | `npm start -- --reset-cache` then press `r` |
| New JS-only npm package | `npm install` → press `r` |
| New native npm package | `npm install` → rebuild (see below) |
| `.env` file changed | Rebuild (see below) |
| `android/build.gradle` changed | Rebuild (see below) |

**Rebuild command** (use this whenever a rebuild is needed):

```bash
cd frontend-app/android
rm -rf app/build
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

> **Why `rm -rf app/build` and not `./gradlew clean`?**
> `./gradlew clean` wipes build artifacts from all modules including `react-native-reanimated`. This causes a CMake prefab error on the next build. Deleting only `app/build` keeps library artifacts intact and avoids this issue.

**Quick alternative — single rebuild + launch command:**

```bash
cd frontend-app
npx react-native run-android
```

> This builds, installs, and launches the app in one step. Use it for a fast rebuild when you have not made any native changes and do not need a clean build. **Prefer the manual `./gradlew` workflow above** when troubleshooting build errors, after a `rm -rf app/build` clean, or when native modules behave unexpectedly — it gives more control and avoids Metro conflicts. Make sure to **stop any running Metro instance** before using this command, as it starts its own.

**If you get a CMake / prefab ordering error:**

```bash
cd frontend-app/android
./gradlew :react-native-reanimated:assembleDebug
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

**Nuclear reset (last resort):**

```bash
cd frontend-app/android
rm -rf app/build ~/.gradle/caches
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

---

### Build a Debug APK

A debug APK can be shared and installed on any Android device with *Install from Unknown Sources* enabled.

```bash
cd frontend-app/android
./gradlew assembleDebug
```

APK location:
```
frontend-app/android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk   ← Apple Silicon Mac emulator + any physical ARM64 Android device
frontend-app/android/app/build/outputs/apk/debug/app-x86_64-debug.apk      ← Intel Mac emulator only
```

Install on a connected device or emulator:
```bash
cd frontend-app/android

# Apple Silicon Mac (M1/M2/M3/M4) — emulator OR physical Android device
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk

# Intel Mac — emulator only
adb install -r app/build/outputs/apk/debug/app-x86_64-debug.apk
```

> **Using a physical device?** Update `.env` to use your Mac's LAN IP (`http://192.168.x.x:8000`) instead of `localhost`, then rebuild the APK. No `adb reverse` is needed for physical devices.

---

### Build a Release APK

Required for Play Store submission. Needs a signed keystore.

#### Step 1 — Generate a release keystore (one time only)

```bash
keytool -genkeypair -v \
  -keystore frontend-app/android/app/buddyapp-release.keystore \
  -alias buddyapp \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

Keep the keystore file and passwords safe — required for every future release.

#### Step 2 — Add credentials to `android/gradle.properties`

```properties
BUDDYAPP_RELEASE_STORE_FILE=buddyapp-release.keystore
BUDDYAPP_RELEASE_KEY_ALIAS=buddyapp
BUDDYAPP_RELEASE_STORE_PASSWORD=your_store_password
BUDDYAPP_RELEASE_KEY_PASSWORD=your_key_password
```

#### Step 3 — Update signing config in `android/app/build.gradle`

```groovy
signingConfigs {
    release {
        storeFile file(BUDDYAPP_RELEASE_STORE_FILE)
        storePassword BUDDYAPP_RELEASE_STORE_PASSWORD
        keyAlias BUDDYAPP_RELEASE_KEY_ALIAS
        keyPassword BUDDYAPP_RELEASE_KEY_PASSWORD
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
    }
}
```

#### Step 4 — Build

```bash
cd frontend-app/android
./gradlew assembleRelease
```

Output:
```
frontend-app/android/app/build/outputs/apk/release/app-release.apk
```

---

## iOS

> iOS builds require macOS 13 (Ventura) or newer.

### One-Time Setup (iOS)

#### Step 1 — Install Xcode

Install Xcode 15 or newer from the Mac App Store, then:

```bash
sudo xcodebuild -license accept
xcode-select --install
```

#### Step 2 — Install CocoaPods and Ruby

The macOS system Ruby is too old. Use `rbenv`:

```bash
brew install rbenv ruby-build
echo 'eval "$(rbenv init - zsh)"' >> ~/.zshrc
source ~/.zshrc
rbenv install 3.3.0
rbenv global 3.3.0
gem install cocoapods
```

Verify: `pod --version` should print 1.14.x or higher.

#### Step 3 — Install iOS Dependencies

```bash
cd frontend-app/ios
pod install
```

> First `pod install` takes 5–15 minutes — compiles native modules (Skia, Reanimated, Notifee).

Always open the **workspace**, never the project file:
```
frontend-app/ios/BuddyApp.xcworkspace
```

#### Step 4 — First Run

Open two terminals (both from `buddy-app/`):

```bash
# Terminal 1 — keep running
cd frontend-app
npm start

# Terminal 2
cd frontend-app
npm run ios
```

---

### Daily Workflow (iOS)

**Step 1 — Start the backend**
```bash
docker compose up
```

**Step 2 — Start Metro (Terminal 1)**
```bash
cd frontend-app
npm start
```

**Step 3 — Launch the app (Terminal 2)**
```bash
cd frontend-app
npm run ios
```

Or open a specific simulator:
```bash
cd frontend-app
npm run ios -- --simulator="iPhone 15 Pro"
```

**Step 4 — Make changes**

Edit any `.ts` / `.tsx` file and save. Metro hot-reloads instantly. Press `r` in the Metro terminal if a change doesn't appear.

---

### When to Rebuild (iOS)

| What changed | Action required |
|---|---|
| `.ts` / `.tsx` / `.js` file | Nothing — Metro hot-reloads on save |
| Change not appearing | Press `r` in the Metro terminal |
| New JS-only npm package | `npm install` → press `r` |
| New native npm package | `npm install` → `pod install` → `npm run ios` |
| `ios/Podfile` changed | `pod install` → `npm run ios` |
| `.env` file changed | `npm run ios` (full rebuild) |

**Full clean rebuild (after config or native changes):**

```bash
cd frontend-app/ios
pod deintegrate && pod install
cd ..
npm run ios
```

**Nuclear clean (clears Xcode DerivedData):**

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData
cd frontend-app/ios
pod deintegrate && pod install
cd ..
npm run ios
```

---

### Build an IPA

Requires an **Apple Developer account** ($99/year).

#### Via Xcode (recommended)

1. Open `frontend-app/ios/BuddyApp.xcworkspace`
2. Set scheme to **BuddyApp**, destination to **Any iOS Device (arm64)**
3. **Product → Archive**
4. In the Organizer → **Distribute App**
   - **Ad Hoc** — install directly on registered test devices
   - **TestFlight** — Apple's beta testing platform
5. Follow the wizard — Xcode signs and exports the `.ipa`

#### Via command line

```bash
# Bundle JS
cd frontend-app
npx react-native bundle \
  --entry-file index.js --platform ios --dev false \
  --bundle-output ios/main.jsbundle --assets-dest ios

# Archive
xcodebuild -workspace ios/BuddyApp.xcworkspace -scheme BuddyApp \
  -sdk iphoneos -configuration Release \
  -archivePath build/BuddyApp.xcarchive archive

# Export IPA
xcodebuild -exportArchive \
  -archivePath build/BuddyApp.xcarchive \
  -exportOptionsPlist ios/ExportOptions.plist \
  -exportPath build/ipa
```

`ios/ExportOptions.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>      <string>ad-hoc</string>
  <key>teamID</key>      <string>YOUR_APPLE_TEAM_ID</string>
  <key>destination</key> <string>export</string>
</dict>
</plist>
```

---

## CI / CD (GitHub Actions)

### Overview

Two workflow files build and publish the mobile app to S3:

| Workflow | File | Runner | Output |
|---|---|---|---|
| Build Android APK | `.github/workflows/build-android-apk.yml` | `ubuntu-latest` | `.apk` |
| Build iOS IPA | `.github/workflows/build-ios-ipa.yml` | `macos-latest` | `.ipa` |

Both are triggered manually from **GitHub → Actions → select workflow → Run workflow**, and require choosing an environment (`dev`, `stg`, or `prod`). The built artifact is uploaded both as a **GitHub Actions artifact** (retained 14 days) and pushed to the **S3 backend bucket**.

---

### GitHub Environment Setup

Before running either workflow, configure secrets in each GitHub environment. Go to **GitHub repository → Settings → Environments → select environment → Add secret**.

Environments used: `dev`, `stg`, `prod`. Each environment needs its own copy of the secrets below.

---

### Shared Secrets (both Android and iOS)

Add these to **every** environment that will run CI builds.

| Secret | Description | Example |
|---|---|---|
| `SUBDOMAIN` | CloudFront subdomain prefix | `buddy` |
| `DOMAIN_NAME` | Root domain | `learning-dev.com` |
| `GOOGLE_CLIENT_ID` | Web OAuth 2.0 Client ID (same value as `.env`) | `491922250866-xxx.apps.googleusercontent.com` |
| `ROLE_ARN` | AWS IAM role ARN for GitHub OIDC authentication | `arn:aws:iam::123456789012:role/github-buddy-ci` |
| `BACKEND_BUCKET_NAME` | S3 bucket where APK / IPA files are uploaded | `buddy360-assets-dev` |

**How the API URL is derived at build time:**

```
prod  →  https://{SUBDOMAIN}.{DOMAIN_NAME}              e.g. https://buddy.learning-dev.com
other →  https://{SUBDOMAIN}-{env}.{DOMAIN_NAME}        e.g. https://buddy-dev.learning-dev.com
```

This value is written into `frontend-app/.env` as both `API_URL` and `CDN_BASE_URL` at the start of every workflow run.

---

### Android-Specific Secrets

The current release build uses the **debug keystore** for signing (suitable for direct device installation and testing). **No additional secrets are needed** beyond the shared set above.

For Play Store submission in the future, replace the debug keystore with a production keystore and add these secrets:

| Secret | Description |
|---|---|
| `KEYSTORE_FILE_BASE64` | Base64-encoded `.jks` release keystore |
| `KEYSTORE_PASSWORD` | Keystore store password |
| `KEY_ALIAS` | Key alias inside the keystore (e.g. `buddyapp`) |
| `KEY_PASSWORD` | Key password |

See [Build a Release APK](#build-a-release-apk) for keystore generation instructions.

---

### Apple Developer Account

#### Free account vs. paid program

Apple offers two tiers. The CI/CD workflow requires the **paid program**.

| Capability | Free Apple ID | Paid ($99 / year) |
|---|---|---|
| Run app on **your own device** via Xcode | ✅ | ✅ |
| Provisioning profile expires after **7 days** (app stops launching; reinstall via Xcode) | ⚠️ | No expiry |
| Max **3 apps** on your device at once | ⚠️ | Unlimited |
| **Distribution certificate** (required by CI) | ❌ | ✅ |
| **Ad Hoc provisioning profile** (required by CI) | ❌ | ✅ |
| **TestFlight** beta distribution | ❌ | ✅ |
| **App Store** submission | ❌ | ✅ |
| Push notifications, CloudKit, etc. | ❌ | ✅ |

The `build-ios-ipa.yml` workflow creates an Ad Hoc `.ipa` and requires both a **Distribution certificate** and an **Ad Hoc provisioning profile** — both are locked behind the paid program.

#### How to enroll

1. Go to [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll)
2. Sign in with the **company Apple ID** (not a personal one — the account owns all certificates and profiles)
3. Choose **Organization** enrollment if building under a company name (requires a D-U-N-S number); choose **Individual** for a solo developer
4. Pay the $99 / year fee
5. Wait for approval (usually instant for Individual; 2–5 days for Organization)

> One enrollment covers all apps built under that team. The **Team ID** shown after enrollment is the value you add as `IOS_APPLE_TEAM_ID` in GitHub.

#### Testing on a real device without the paid program

If you want to test on a physical iPhone during local development before enrolling:

1. Connect the iPhone to your Mac via USB
2. Open `frontend-app/ios/BuddyApp.xcworkspace` in Xcode
3. Select your device in the scheme toolbar (top left)
4. **Signing & Capabilities** → set Team to your free Apple ID
5. Click **Run** — Xcode signs and installs directly
6. The provisioning profile is valid for **7 days** — after that the app stops launching and Xcode reinstalls it automatically on the next run

This is fine for development testing on your own device. CI builds and distributing to other testers both require the paid account.

---

### iOS-Specific Secrets

iOS builds require four extra secrets on top of the shared set. The steps below show how to generate each one.

| Secret | Description |
|---|---|
| `IOS_CERTIFICATE_P12_BASE64` | Base64-encoded Apple Distribution certificate (`.p12`) |
| `IOS_CERTIFICATE_PASSWORD` | Password chosen when exporting the `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64-encoded Ad Hoc provisioning profile (`.mobileprovision`) |
| `IOS_APPLE_TEAM_ID` | 10-character Apple Developer Team ID |

#### Step 1 — Find your Apple Team ID

1. Go to [developer.apple.com](https://developer.apple.com) → **Account**
2. Under **Membership Details**, copy the **Team ID** (10 characters, e.g. `ABCD1234EF`)
3. Add as `IOS_APPLE_TEAM_ID` in GitHub

#### Step 2 — Create and export a Distribution certificate

1. Go to [developer.apple.com](https://developer.apple.com) → **Certificates, IDs & Profiles → Certificates → +**
2. Select **Apple Distribution** → Continue
3. Follow the CSR instructions (Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority)
4. Upload the `.certSigningRequest` file → Download the resulting `.cer`
5. Double-click the `.cer` to add it to **Keychain Access**
6. In Keychain Access → **My Certificates** → right-click the certificate entry → **Export** → save as `.p12` with a strong password
7. Base64-encode it and copy to clipboard:
   ```bash
   # macOS — result is copied to clipboard
   base64 -i /path/to/certificate.p12 | pbcopy
   ```
8. Paste the clipboard value as `IOS_CERTIFICATE_P12_BASE64`. Add the export password as `IOS_CERTIFICATE_PASSWORD`.

#### Step 3 — Register test devices (Ad Hoc only)

Ad Hoc distribution requires each test device's UDID to be registered:

1. **Devices → +** in the Apple Developer portal
2. Enter the device name and UDID
   - On iPhone/iPad: **Settings → General → VPN & Device Management → [device name]** — or connect to Mac and run `system_profiler SPUSBDataType | grep -A 5 "iPhone"`

#### Step 4 — Create an Ad Hoc provisioning profile

1. Go to **Profiles → +** → select **Ad Hoc** under Distribution → Continue
2. Select the App ID for this app (`org.reactjs.native.example.BuddyApp`) → Continue
3. Select the **Distribution certificate** created in Step 2 → Continue
4. Select the **registered test devices** from Step 3 → Continue
5. Name the profile (e.g. `BuddyApp Ad Hoc Dev`) → **Generate** → Download
6. Base64-encode it and copy to clipboard:
   ```bash
   # macOS — result is copied to clipboard
   base64 -i /path/to/BuddyAppAdHocDev.mobileprovision | pbcopy
   ```
7. Paste as `IOS_PROVISIONING_PROFILE_BASE64`

> **Bundle ID note:** The Xcode project currently uses the default React Native bundle ID `org.reactjs.native.example.BuddyApp`. When this is changed to a production ID (e.g. `com.buddyapp`), update the `provisioningProfiles` key inside `build-ios-ipa.yml` and create a new provisioning profile for the new ID.

---

### Running a Build

1. Go to the **GitHub repository → Actions** tab
2. Select **Build Android APK** or **Build iOS IPA** from the left sidebar
3. Click **Run workflow** → choose environment (`dev`, `stg`, or `prod`) → **Run workflow**

Approximate build times:

| Platform | Cached run | Cold run (no cache) |
|---|---|---|
| Android | ~8 min | ~20 min |
| iOS | ~15 min | ~50 min |

---

### Retrieving Build Artifacts

**GitHub artifact** (retained for 14 days):

Go to the completed workflow run → scroll to the **Artifacts** section at the bottom of the page → download the zip.

Artifact name format:
```
buddy360-android-{env}-{git-sha}
buddy360-ios-{env}-{git-sha}
```

**S3** (permanent, timestamped):

```
s3://{BACKEND_BUCKET_NAME}/app-assets/applications/android/app-release-YYYY-MM-DD-HH-MM-SS.apk
s3://{BACKEND_BUCKET_NAME}/app-assets/applications/ios/BuddyApp-YYYY-MM-DD-HH-MM-SS.ipa
```

List and download from S3:

```bash
# List all Android builds in the dev bucket
aws s3 ls s3://buddy360-assets-dev/app-assets/applications/android/

# Download a specific Android build
aws s3 cp s3://buddy360-assets-dev/app-assets/applications/android/app-release-2026-05-28-10-30-00.apk ./

# List all iOS builds in the dev bucket
aws s3 ls s3://buddy360-assets-dev/app-assets/applications/ios/

# Download a specific iOS build
aws s3 cp s3://buddy360-assets-dev/app-assets/applications/ios/BuddyApp-2026-05-28-10-30-00.ipa ./
```

---

### AWS OIDC Setup (one-time, per AWS account)

The `ROLE_ARN` secret assumes an IAM role configured for GitHub OIDC. This is a one-time setup per AWS account. If it hasn't been done yet:

**1 — Add the GitHub OIDC provider in IAM**

- AWS Console → **IAM → Identity providers → Add provider**
- Provider type: **OpenID Connect**
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

**2 — Create an IAM role**

Create a role with the following trust policy (replace `YOUR_ORG` and `buddy-app`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::{ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/buddy-app:*"
        },
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

**3 — Attach a permissions policy**

The role needs at minimum:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::{BACKEND_BUCKET_NAME}/app-assets/applications/*"
    }
  ]
}
```

**4 — Add the Role ARN as a secret**

Copy the Role ARN (format: `arn:aws:iam::123456789012:role/role-name`) and add it as `ROLE_ARN` in each GitHub environment.

---

## Environment Variables

Managed by `react-native-config`. File location: `frontend-app/.env`

| Variable | Description | Local dev value |
|---|---|---|
| `API_URL` | Backend base URL | `http://localhost:8000` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | leave blank for now |

**Important rules:**
- Changing `.env` always requires a **native rebuild** (`rm -rf app/build && ./gradlew assembleDebug` for Android, `npm run ios` for iOS)
- `npm start --reset-cache` alone is **not** enough after a `.env` change
- For Android emulator, always run `adb reverse tcp:8000 tcp:8000` after starting the emulator so `localhost:8000` resolves correctly
- For a real physical device (Android or iOS), replace `localhost` with your Mac's LAN IP: `http://192.168.x.x:8000`

---

## Google Sign-In Setup

Google Sign-In uses the native Android sign-in sheet via `@react-native-google-signin/google-signin`. The JS code is already wired up. The steps below are a one-time registration in Google Cloud Console that must be done for each signing certificate (debug + release).

### How it works

- The app is configured with your **Web OAuth Client ID** (`GOOGLE_CLIENT_ID` in `.env`).
- Google also requires an **Android OAuth Client ID** registered for each signing certificate's SHA-1 fingerprint. This tells Google "this APK is authorised to request tokens". You do not use the Android Client ID in code — just having it registered is enough.
- On sign-in, the native sheet returns an `idToken` which is sent to the backend's `/auth/google` endpoint for verification.

---

### Step 1 — Get the SHA-1 fingerprint of your keystore

**Debug keystore** (for emulator and debug APKs):

```bash
cd frontend-app/android
keytool -list -v \
  -keystore app/debug.keystore \
  -alias androiddebugkey \
  -storepass android \
  -keypass android \
  | grep SHA1
```

Example output:
```
SHA1: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD
```

**Release keystore** (for release APKs — run after generating your release keystore):

```bash
cd frontend-app/android
keytool -list -v \
  -keystore app/buddyapp-release.keystore \
  -alias buddyapp \
  | grep SHA1
```

---

### Step 2 — Register an Android OAuth Client ID in Google Cloud Console

Do this once for the debug keystore, and again later for the release keystore.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth Client ID**
3. Set **Application type** to **Android**
4. Fill in:
   - **Package name:** `com.buddyapp`
   - **SHA-1 certificate fingerprint:** paste the SHA1 from Step 1
5. Click **Create**

> You do not need to note down the new Android Client ID — Google validates the APK's signature automatically at runtime. The only ID used in code is the Web Client ID below.

---

### Step 3 — Set the Web Client ID in `.env`

The `GOOGLE_CLIENT_ID` in `frontend-app/.env` must be the **Web OAuth 2.0 Client ID** (not the Android one you just created). Find it in Google Cloud Console → **APIs & Services → Credentials** — it ends in `.apps.googleusercontent.com` and has type "Web application".

```env
GOOGLE_CLIENT_ID=491922250866-xxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

> Changing `.env` requires a native rebuild (see [When to Rebuild](#when-to-rebuild-android)).

---

### Step 4 — Rebuild the app

Because `@react-native-google-signin/google-signin` is a native module, a full rebuild is required after adding it. A Metro reload (`r`) is not enough.

```bash
cd frontend-app/android
rm -rf app/build
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

---

### Step 5 — Set up the ADB tunnel (emulator only)

The Google sign-in sheet makes a network call back through the app. Make sure the ADB reverse tunnel is active:

```bash
adb reverse tcp:8000 tcp:8000
```

---

### Troubleshooting Google Sign-In

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-in sheet does not appear | Native module not linked | Full rebuild (Step 4) |
| `DEVELOPER_ERROR` / error code 10 | SHA-1 not registered, wrong package name, or wrong Client ID type | Re-check Steps 1–3; ensure you registered the **debug** keystore SHA-1 and the `GOOGLE_CLIENT_ID` is the **Web** client ID |
| `SIGN_IN_CANCELLED` | User dismissed the sheet | No action needed |
| `PLAY_SERVICES_NOT_AVAILABLE` | Emulator image has no Play Services | Use a Play Store system image in Android Studio (e.g. Pixel 7 API 34 with Google Play) |
| "Google sign-in is not configured on the server" | Backend `GOOGLE_CLIENT_ID` not set | Set `GOOGLE_CLIENT_ID` in the backend environment and redeploy |
| Sign-in works locally but fails on release APK | Release keystore SHA-1 not registered | Register the release keystore SHA-1 (Step 1 + Step 2) |

---

## Troubleshooting

### Network request failed / Login failed

**Symptoms:** "Network request failed", "Login failed", any API call fails silently.

**Most likely cause:** The ADB reverse tunnel is not set up, or the backend is not running.

```bash
# 1. Confirm backend is running
curl http://localhost:8000/api/health

# 2. Set up the ADB reverse tunnel (run once every time the emulator starts)
#    This makes localhost:8000 inside the emulator resolve to your Mac's localhost:8000.
#    Without this step, ALL network calls — including login — will fail.
adb reverse tcp:8000 tcp:8000

# 3. If .env was recently changed, rebuild the APK
cd frontend-app/android
rm -rf app/build
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

### App shows a blank white screen

Metro is not connected. Make sure `npm start` is running inside `frontend-app/`, then press `r` in that terminal to force-reload.

### Changes not appearing after save

**Step 1 — Press `r`** in the Metro terminal to trigger a JS reload.

**Step 2 — If `r` doesn't help**, stop Metro and restart it with the cache cleared:

```bash
cd frontend-app
npm start -- --reset-cache
# equivalently: npx react-native start --reset-cache
```

Once Metro finishes starting, **press `r` again** in that terminal (or shake the emulator → Reload) to load the freshly built bundle.

> This is the fix when UI or style changes to `.tsx` files are not showing up even after a normal reload.

### Metro port 8081 already in use

Another Metro instance is still running. Kill it and restart:

```bash
kill -9 $(lsof -ti :8081)
cd frontend-app
npm start
```

### APK install hangs at 99% for several minutes

The ADB connection to the emulator stalled. Kill and restart:

```bash
kill -9 $(lsof -ti :5037)   # kill ADB server
adb start-server
adb devices                  # confirm emulator shows as "device" not "offline"
cd frontend-app/android
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

If the emulator shows `offline`, cold boot it: Android Studio → Device Manager → ▼ → Cold Boot Now.

### `INSTALL_FAILED_NO_MATCHING_ABIS`

You are installing the wrong ABI variant for your CPU. On Apple Silicon Mac (M1/M2/M3/M4) always use the arm64-v8a APK:

```bash
cd frontend-app/android
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

On Intel Mac with the default x86_64 emulator:

```bash
cd frontend-app/android
adb install -r app/build/outputs/apk/debug/app-x86_64-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

### `NDK did not have a source.properties file`

NDK folder exists but was never properly downloaded. Delete it first:

```bash
rm -rf ~/Library/Android/sdk/ndk/27.1.12297006
```

Then reinstall via Android Studio → **Tools → SDK Manager → SDK Tools tab** → enable *Show Package Details* → **NDK (Side by side) → 27.1.12297006** → Apply.

### CMake prefab ordering error after a clean

Do not use `./gradlew clean`. Use this instead:

```bash
cd frontend-app/android
rm -rf app/build
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

If the error persists, force reanimated to build first:

```bash
cd frontend-app/android
./gradlew :react-native-reanimated:assembleDebug
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

### `react-native-worklets library not found`

Install the package:

```bash
cd frontend-app
npm install react-native-worklets@0.8
```

Then rebuild the APK (native package change requires a full rebuild):

```bash
cd frontend-app/android
rm -rf app/build
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
adb shell am start -n com.buddyapp/.MainActivity
```

### `Gradle requires JVM 17 or later`

Your shell is defaulting to an older Java version. Check what is installed and pin `JAVA_HOME` to Java 17:

```bash
# List all installed JDKs
/usr/libexec/java_home -V

# Set JAVA_HOME for this session (replace path with the one printed for your Java 17 install)
export JAVA_HOME=/Library/Java/JavaVirtualMachines/amazon-corretto-17.jdk/Contents/Home

# Verify
java -version   # must print 17.x.x

# Make it permanent
echo 'export JAVA_HOME=/Library/Java/JavaVirtualMachines/amazon-corretto-17.jdk/Contents/Home' >> ~/.zshrc
source ~/.zshrc
```

If Java 17 is not installed at all, install it via Homebrew:

```bash
brew install --cask temurin@17
```

Then set `JAVA_HOME` to `/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home`.

---

### `adb: command not found`

`ANDROID_HOME` is not set. Add to `~/.zshrc` and reload:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
source ~/.zshrc
```

### iOS pod issues

```bash
cd frontend-app/ios
pod deintegrate && pod install
cd ..
npm run ios
```
