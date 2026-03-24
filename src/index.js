const { getLocalIP } = require('./util/network');
const EmulatorState = require('./ble/state');
const { startPeripheral } = require('./ble/peripheral');
const { startPreviewServer } = require('./http/preview-server');
const { startDashboard } = require('./dashboard/server');

const ip = getLocalIP();
console.log('');
console.log('  Headspace BLE Emulator');
console.log('  ──────────────────────');
console.log(`  Local IP:   ${ip}`);
console.log('');

const state = new EmulatorState(ip);

startPreviewServer(state, 8080);
startDashboard(state, 3000);
startPeripheral(state);
