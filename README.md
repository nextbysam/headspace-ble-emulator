# Headspace BLE Emulator

Turns your Mac into a fake Headspace device over Bluetooth LE. Test the full iOS/Android app flow without hardware.

## Setup

```bash
git clone https://github.com/nextbysam/headspace-ble-emulator.git
cd headspace-ble-emulator
npm install
npm start
```

## Requirements

- macOS with Bluetooth
- Node.js 18+
- Xcode Command Line Tools (`xcode-select --install`)
- Grant Bluetooth permission to Terminal when prompted

## What it does

- **BLE peripheral** advertising as `Headspace-TEST`
- **Improv WiFi service** — accepts and logs WiFi credentials
- **Device Manager service** — emulates all 7 characteristics (device info, battery, storage, recording state/control, preview info, operator info)
- **HTTP preview server** on `:8080` — serves test JPEG when recording
- **Web dashboard** on `:3000` — shows everything the emulator receives in real-time

## Dashboard

Open `http://localhost:3000` to see:
- BLE connection status
- Device info (serial, firmware, IP)
- Operator info received from app
- WiFi credentials received from app
- Recording state with live timer
- Event log

## Testing with the app

1. Run `npm start`
2. Open the iOS app on a physical iPhone (simulators don't support BLE)
3. Go to Device Manager → Scan
4. Tap "Headspace-TEST"
5. The full flow works: connect → WiFi check → recording modes

## Emulated protocol

| Service | Characteristics |
|---------|----------------|
| Improv WiFi (0x8000) | Current State, Error State, RPC Command, RPC Result, Capabilities |
| Device Manager (0x8100) | Device Info, Battery, Storage, Recording State, Recording Control, Preview Info, Operator Info |
