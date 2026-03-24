const bleno = require('@abandonware/bleno');
const { createImprovService, SERVICE_UUID: IMPROV_UUID } = require('./improv-service');
const { createDeviceManagerService } = require('./device-manager-service');

const DEVICE_NAME = 'Headspace-TEST';

function startPeripheral(state) {
  const improvService = createImprovService(state);
  const deviceManagerService = createDeviceManagerService(state);

  bleno.on('stateChange', (bleState) => {
    console.log(`[BLE] Adapter state: ${bleState}`);
    if (bleState === 'poweredOn') {
      bleno.startAdvertising(DEVICE_NAME, [IMPROV_UUID], (err) => {
        if (err) {
          console.error('[BLE] Advertising error:', err);
        } else {
          console.log(`[BLE] Advertising as "${DEVICE_NAME}"`);
        }
      });
    } else {
      bleno.stopAdvertising();
    }
  });

  bleno.on('advertisingStart', (err) => {
    if (err) {
      console.error('[BLE] Advertising start error:', err);
      return;
    }
    bleno.setServices([improvService, deviceManagerService], (err) => {
      if (err) {
        console.error('[BLE] Set services error:', err);
      } else {
        console.log('[BLE] GATT services registered (2 services, 12 characteristics)');
      }
    });
  });

  bleno.on('accept', (clientAddress) => {
    state.setConnected(true);
    // Stop advertising while connected
    bleno.stopAdvertising();
  });

  bleno.on('disconnect', (clientAddress) => {
    state.setConnected(false);
    // Resume advertising
    bleno.startAdvertising(DEVICE_NAME, [IMPROV_UUID]);
  });
}

module.exports = { startPeripheral };
