const EventEmitter = require('events');

class EmulatorState extends EventEmitter {
  constructor(localIP) {
    super();
    this.bleConnected = false;
    this.deviceSerial = 'AWL-TEST-0001';
    this.firmwareVersion = '1.0.0';
    this.ipAddress = localIP || '';
    this.batteryPercent = 85;
    this.batteryCharging = 0;
    this.storageUsedMB = 10240;
    this.storageTotalMB = 65536;
    this.recordingState = 0x00; // idle
    this.recordingMode = 0x00;  // none
    this.recordingElapsed = 0;
    this.recordingBytesKB = 0;
    this.uploadStatus = 0x00;
    this.operatorPhone = null;
    this.operatorHeight = null;
    this.wifiSSID = null;
    this.wifiPassword = null;
    this.improvState = 0x02; // AUTHORIZED
    this.improvError = 0x00;
    this._recordingTimer = null;
    this._events_log = [];
  }

  log(msg) {
    const entry = { time: new Date().toISOString(), message: msg };
    this._events_log.unshift(entry);
    if (this._events_log.length > 100) this._events_log.pop();
    console.log(`[EMU] ${msg}`);
    this.emit('state-updated', this.snapshot());
  }

  snapshot() {
    return {
      bleConnected: this.bleConnected,
      deviceSerial: this.deviceSerial,
      firmwareVersion: this.firmwareVersion,
      ipAddress: this.ipAddress,
      batteryPercent: this.batteryPercent,
      batteryCharging: this.batteryCharging,
      storageUsedMB: this.storageUsedMB,
      storageTotalMB: this.storageTotalMB,
      recordingState: this.recordingState,
      recordingMode: this.recordingMode,
      recordingElapsed: this.recordingElapsed,
      recordingBytesKB: this.recordingBytesKB,
      uploadStatus: this.uploadStatus,
      operatorPhone: this.operatorPhone,
      operatorHeight: this.operatorHeight,
      wifiSSID: this.wifiSSID,
      wifiPassword: this.wifiPassword,
      improvState: this.improvState,
      improvError: this.improvError,
      events: this._events_log.slice(0, 50),
    };
  }

  setConnected(val) {
    this.bleConnected = val;
    this.log(val ? 'BLE client connected' : 'BLE client disconnected');
  }

  setOperatorInfo(phone, height) {
    this.operatorPhone = phone;
    this.operatorHeight = height;
    this.log(`Operator info: phone=${phone}, height=${height}cm`);
  }

  setWiFiCredentials(ssid, password) {
    this.wifiSSID = ssid;
    this.wifiPassword = password;
    this.log(`WiFi credentials: SSID="${ssid}"`);
  }

  startRecording(mode) {
    this.recordingState = 0x01;
    this.recordingMode = mode;
    this.recordingElapsed = 0;
    this.recordingBytesKB = 0;
    this.uploadStatus = mode === 0x02 ? 0x01 : 0x00;
    const modeStr = mode === 0x01 ? 'local' : 'live_stream';
    this.log(`Recording started (mode: ${modeStr})`);
    this.emit('recording-changed');

    this._recordingTimer = setInterval(() => {
      this.recordingElapsed += 2;
      this.recordingBytesKB += 3000;
      this.emit('recording-changed');
      this.emit('state-updated', this.snapshot());
    }, 2000);
  }

  stopRecording() {
    if (this._recordingTimer) {
      clearInterval(this._recordingTimer);
      this._recordingTimer = null;
    }
    this.recordingState = 0x02; // stopping
    this.log('Recording stopping...');
    this.emit('recording-changed');

    setTimeout(() => {
      this.recordingState = 0x00;
      this.recordingMode = 0x00;
      this.recordingElapsed = 0;
      this.recordingBytesKB = 0;
      this.uploadStatus = 0x00;
      this.log('Recording stopped');
      this.emit('recording-changed');
      this.emit('state-updated', this.snapshot());
    }, 500);
  }

  provision(ip) {
    this.improvState = 0x04; // PROVISIONED
    this.ipAddress = ip;
    this.log(`WiFi provisioned — IP: ${ip}`);
    this.emit('provisioned', ip);
    this.emit('state-updated', this.snapshot());
  }
}

module.exports = EmulatorState;
