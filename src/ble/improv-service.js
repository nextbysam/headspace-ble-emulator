const bleno = require('@abandonware/bleno');
const { getLocalIP } = require('../util/network');

const SERVICE_UUID = '00467768622822724663277478268000';

const UUID_CURRENT_STATE = '00467768622822724663277478268001';
const UUID_ERROR_STATE   = '00467768622822724663277478268002';
const UUID_RPC_COMMAND   = '00467768622822724663277478268003';
const UUID_RPC_RESULT    = '00467768622822724663277478268004';
const UUID_CAPABILITIES  = '00467768622822724663277478268005';

function createImprovService(state) {
  let currentStateNotify = null;
  let errorStateNotify = null;
  let rpcResultNotify = null;

  // Current State
  const currentStateChar = new bleno.Characteristic({
    uuid: UUID_CURRENT_STATE,
    properties: ['read', 'notify'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, Buffer.from([state.improvState]));
    },
    onSubscribe: (maxSize, updateCb) => { currentStateNotify = updateCb; },
    onUnsubscribe: () => { currentStateNotify = null; },
  });

  // Error State
  const errorStateChar = new bleno.Characteristic({
    uuid: UUID_ERROR_STATE,
    properties: ['read', 'notify'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, Buffer.from([state.improvError]));
    },
    onSubscribe: (maxSize, updateCb) => { errorStateNotify = updateCb; },
    onUnsubscribe: () => { errorStateNotify = null; },
  });

  // RPC Result
  const rpcResultChar = new bleno.Characteristic({
    uuid: UUID_RPC_RESULT,
    properties: ['read', 'notify'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, Buffer.alloc(0));
    },
    onSubscribe: (maxSize, updateCb) => { rpcResultNotify = updateCb; },
    onUnsubscribe: () => { rpcResultNotify = null; },
  });

  // RPC Command (write)
  const rpcCommandChar = new bleno.Characteristic({
    uuid: UUID_RPC_COMMAND,
    properties: ['write'],
    onWriteRequest: (data, offset, withoutResponse, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS);

      if (data.length < 4 || data[0] !== 0x01) {
        state.log('Invalid RPC command received');
        return;
      }

      // Parse: [0x01][data_len][ssid_len][ssid...][pwd_len][pwd...][checksum]
      let pos = 2; // skip cmd_type and data_len
      const ssidLen = data[pos++];
      const ssid = data.slice(pos, pos + ssidLen).toString('utf8');
      pos += ssidLen;
      const pwdLen = data[pos++];
      const password = data.slice(pos, pos + pwdLen).toString('utf8');

      state.setWiFiCredentials(ssid, password);

      // Simulate provisioning delay
      setTimeout(() => {
        const ip = getLocalIP();
        state.provision(ip);

        // Notify current state -> PROVISIONED (0x04)
        if (currentStateNotify) {
          currentStateNotify(Buffer.from([0x04]));
        }

        // Notify RPC result with IP
        const ipBuf = Buffer.from(ip, 'utf8');
        const resultBuf = Buffer.alloc(2 + 1 + ipBuf.length);
        resultBuf[0] = 0x01; // command type
        resultBuf[1] = 1 + ipBuf.length; // data length
        resultBuf[2] = ipBuf.length; // string length
        ipBuf.copy(resultBuf, 3);

        if (rpcResultNotify) {
          rpcResultNotify(resultBuf);
        }
      }, 2000);
    },
  });

  // Capabilities
  const capabilitiesChar = new bleno.Characteristic({
    uuid: UUID_CAPABILITIES,
    properties: ['read'],
    onReadRequest: (offset, cb) => {
      cb(bleno.Characteristic.RESULT_SUCCESS, Buffer.from([0x01]));
    },
  });

  return new bleno.PrimaryService({
    uuid: SERVICE_UUID,
    characteristics: [
      currentStateChar,
      errorStateChar,
      rpcCommandChar,
      rpcResultChar,
      capabilitiesChar,
    ],
  });
}

module.exports = { createImprovService, SERVICE_UUID };
