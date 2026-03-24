const bleno = require('@abandonware/bleno');

const SERVICE_UUID = 'A0467768622822724663277478268100';

const UUID_DEVICE_INFO       = 'A0467768622822724663277478268101';
const UUID_BATTERY_LEVEL     = 'A0467768622822724663277478268102';
const UUID_STORAGE_INFO      = 'A0467768622822724663277478268103';
const UUID_RECORDING_STATE   = 'A0467768622822724663277478268104';
const UUID_RECORDING_CONTROL = 'A0467768622822724663277478268105';
const UUID_PREVIEW_INFO      = 'A0467768622822724663277478268106';
const UUID_OPERATOR_INFO     = 'A0467768622822724663277478268107';

function encodeString(str) {
  const buf = Buffer.from(str, 'utf8');
  return Buffer.concat([Buffer.from([buf.length]), buf]);
}

function encodeDeviceInfo(state) {
  return Buffer.concat([
    encodeString(state.deviceSerial),
    encodeString(state.firmwareVersion),
    encodeString(state.ipAddress),
  ]);
}

function encodeStorageInfo(state) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(state.storageUsedMB, 0);
  buf.writeUInt32LE(state.storageTotalMB, 4);
  return buf;
}

function encodeRecordingState(state) {
  const buf = Buffer.alloc(11);
  buf[0] = state.recordingState;
  buf[1] = state.recordingMode;
  buf.writeUInt32LE(state.recordingElapsed, 2);
  buf.writeUInt32LE(state.recordingBytesKB, 6);
  buf[10] = state.uploadStatus;
  return buf;
}

function encodePreviewInfo(state) {
  if (!state.ipAddress) return Buffer.from([0]);
  const url = `http://${state.ipAddress}:8080/preview.jpg`;
  return encodeString(url);
}

function createDeviceManagerService(state) {
  let recordingStateNotify = null;
  let batteryNotify = null;
  let storageNotify = null;

  // Listen for recording changes to send notifications
  state.on('recording-changed', () => {
    if (recordingStateNotify) {
      recordingStateNotify(encodeRecordingState(state));
    }
  });

  // Periodic battery/storage notifications (every 5s)
  setInterval(() => {
    if (batteryNotify) {
      batteryNotify(Buffer.from([state.batteryPercent, state.batteryCharging]));
    }
    if (storageNotify) {
      storageNotify(encodeStorageInfo(state));
    }
  }, 5000);

  // Device Info (read)
  const deviceInfoChar = new bleno.Characteristic({
    uuid: UUID_DEVICE_INFO,
    properties: ['read'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, encodeDeviceInfo(state));
    },
  });

  // Battery Level (read, notify)
  const batteryChar = new bleno.Characteristic({
    uuid: UUID_BATTERY_LEVEL,
    properties: ['read', 'notify'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, Buffer.from([state.batteryPercent, state.batteryCharging]));
    },
    onSubscribe: (maxSize, updateCb) => { batteryNotify = updateCb; },
    onUnsubscribe: () => { batteryNotify = null; },
  });

  // Storage Info (read, notify)
  const storageChar = new bleno.Characteristic({
    uuid: UUID_STORAGE_INFO,
    properties: ['read', 'notify'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, encodeStorageInfo(state));
    },
    onSubscribe: (maxSize, updateCb) => { storageNotify = updateCb; },
    onUnsubscribe: () => { storageNotify = null; },
  });

  // Recording State (read, notify)
  const recordingStateChar = new bleno.Characteristic({
    uuid: UUID_RECORDING_STATE,
    properties: ['read', 'notify'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, encodeRecordingState(state));
    },
    onSubscribe: (maxSize, updateCb) => { recordingStateNotify = updateCb; },
    onUnsubscribe: () => { recordingStateNotify = null; },
  });

  // Recording Control (write)
  const recordingControlChar = new bleno.Characteristic({
    uuid: UUID_RECORDING_CONTROL,
    properties: ['write'],
    onWriteRequest: (data, offset, withoutResponse, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS);
      if (data.length < 1) return;

      const cmd = data[0];
      if (cmd === 0x01 && data.length >= 2) {
        const mode = data[1];
        state.startRecording(mode);
      } else if (cmd === 0x02) {
        state.stopRecording();
      } else {
        state.log(`Unknown recording command: 0x${cmd.toString(16)}`);
      }
    },
  });

  // Preview Info (read)
  const previewInfoChar = new bleno.Characteristic({
    uuid: UUID_PREVIEW_INFO,
    properties: ['read'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, encodePreviewInfo(state));
    },
  });

  // Operator Info (write)
  const operatorInfoChar = new bleno.Characteristic({
    uuid: UUID_OPERATOR_INFO,
    properties: ['write'],
    onWriteRequest: (data, offset, withoutResponse, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS);
      if (data.length < 3) {
        state.log('Operator info too short');
        return;
      }

      const phoneLen = data[0];
      if (1 + phoneLen + 2 > data.length) {
        state.log('Operator info invalid length');
        return;
      }

      const phone = data.slice(1, 1 + phoneLen).toString('utf8');
      const heightCm = data.readUInt16LE(1 + phoneLen);
      state.setOperatorInfo(phone, heightCm);
    },
  });

  return new bleno.PrimaryService({
    uuid: SERVICE_UUID,
    characteristics: [
      deviceInfoChar,
      batteryChar,
      storageChar,
      recordingStateChar,
      recordingControlChar,
      previewInfoChar,
      operatorInfoChar,
    ],
  });
}

module.exports = { createDeviceManagerService, SERVICE_UUID };
