# Haptics Studio Android Companion App

Sample Android companion app that pairs with the Haptics Studio desktop application. It auditions
haptic clips authored on the desktop on a real Android device.

This project is intended as **sample code** demonstrating how to build a companion app for Haptics
Studio. It is written in native Kotlin with Jetpack Compose.

## Requirements

- Android Studio (Ladybug or later recommended)
- A physical Android 12+ (API 31) device — vibration/haptic feedback does **not** play on emulators.
  Android 16 (API 36) with envelope effect support is needed for PWLE playback (see below)
- Android SDK platform 36 (`compileSdk = 36`)
- The desktop device and the Android device must be on the **same local network**

## Getting Started

1. Open the `companion/android` folder in Android Studio and let Gradle sync.
2. Select your Android device as the run target and press **Run**.
3. Start Haptics Studio on the desktop and open a project that contains clips.
4. The desktop appears in the app's discovery list. Tap it (or enter its IP manually), then type the
   pairing code shown on the desktop to connect.
5. Tap a clip to play its haptic on the device, synced with its audio.

You can also build from the command line:

```bash
cd companion/android
./gradlew assembleDebug      # build the debug APK
./gradlew installDebug       # install onto a connected device
./gradlew testDebugUnitTest  # run the unit tests (envelope fitting)
```

## How It Works

| File | Purpose |
| --- | --- |
| `MainActivity.kt` | App entry point. Hosts the Compose `AppNavHost`. |
| `ui/AppNavHost.kt` | Navigation graph: discovery screen → clips screen. |
| `ui/DiscoveryScreen.kt` | Lists discovered desktop hosts and falls back to manual IP entry. |
| `ui/ClipsScreen.kt` | Connecting / pairing-code / clip-list states and playback triggers. |
| `ui/theme/*` | Compose Material 3 dark theme mirroring the desktop palette. |
| `discovery/UdpDiscovery.kt` | Listens for UDP broadcasts (port 9998) to discover desktop hosts on the LAN. |
| `discovery/DiscoveryViewModel.kt` | Owns the discovery lifecycle and exposes discovered hosts. |
| `net/SocketClient.kt` | Thin wrapper over the `io.socket` client (port 9999, path `/ws`). |
| `net/ProjectViewModel.kt` | Handles auth, fetches the current project, prefetches audio, and plays clips. |
| `playback/HapticPlayer.kt` | Plays the PWLE envelope with `VibrationEffect.BasicEnvelopeBuilder` when supported, otherwise the waveform with `VibrationEffect.createWaveform`, synced to the clip's `.wav` audio. |
| `playback/AudioCache.kt` | Caches clip audio downloaded from the desktop in the app's cache directory. |
| `model/Models.kt` | Data models for the discovery endpoint, project, clips, waveform, and PWLE envelope. |

## Network Permissions

The app requests `INTERNET`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`, and `VIBRATE`.
Discovery relies on receiving UDP broadcasts on the local network, which requires holding a
`WifiManager.MulticastLock` while listening. If discovery does not find the desktop, use the
**Can't find your device?** option to enter the desktop's IP address directly.

Because the desktop connection is an unencrypted Socket.IO connection (`ws://<ip>:9999`) on the
local network, the sample enables cleartext traffic via
`res/xml/network_security_config.xml`.

## Protocol

The companion talks to the desktop over Socket.IO (v3-compatible) on `ws://<ip>:9999`, path `/ws`:

| Event | Direction | Payload |
| --- | --- | --- |
| discovery broadcast | desktop → app (UDP :9998) | `{hostname, port}` |
| connect query | app → desktop | `deviceId, name, model, version` |
| `auth_required` | desktop → app | (none) → show code entry |
| `auth_request` | app → desktop | `{authCode}` |
| `auth_request` | desktop → app | `{status: "ok" \| "error"}` |
| `auth_granted` | desktop → app | (none) |
| `current_project` | app → desktop | (none) |
| `current_project` | desktop → app | `Project` JSON |
| `get_audio` | app → desktop | `{clipId, binary: true}` |
| `get_audio_binary` | desktop → app | `{clipId, audio: byte[]}` |
| `get_android` | app → desktop | `{clipId}` |
| `get_android` | desktop → app | `{clipId, data: {amplitudes:int[], timings:int[]}}` |
| `get_android_pwle` | app → desktop | `{clipId}` |
| `get_android_pwle` | desktop → app | `{clipId, data: {control_points: {amplitude, frequency, duration_ms}[], transients: {amplitude, time_ms}[]}}` |

## PWLE Playback

On Android 16 (API 36) and later, devices whose vibrator supports envelope effects can play a clip as
a piecewise linear envelope (PWLE) instead of a sampled waveform. See the Android documentation on
[PWLE](https://source.android.com/docs/core/interaction/haptics/haptics-pwle) and
[custom haptic effects](https://developer.android.com/develop/ui/views/haptics/custom-haptic-effects).

- The app checks `Vibrator.areEnvelopeEffectsSupported()` and, when it is `true`, requests
  `get_android_pwle` instead of `get_android`. Amplitude and frequency are normalized to 0-1, and are
  passed to `VibrationEffect.BasicEnvelopeBuilder` as intensity and sharpness.
- Control points are fitted to the limits reported by `Vibrator.getEnvelopeEffectInfo()`: points
  closer than the minimum duration are merged, and longer segments are split with linear
  interpolation.
- Android cannot play an envelope effect and a composition together, so the `transients` of the
  reply are ignored.
- If the envelope cannot be played (it has more points or is longer than the device allows, or
  building the effect fails), the app requests `get_android` once and plays the waveform instead.
  Devices without envelope effect support use the waveform path directly.
