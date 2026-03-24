const ws = new WebSocket(`ws://${location.host}`);

const STATE_NAMES = { 0: 'IDLE', 1: 'RECORDING', 2: 'STOPPING', 3: 'ERROR' };
const MODE_NAMES = { 0: '—', 1: 'Local', 2: 'Live Stream' };

ws.onmessage = (event) => {
  const s = JSON.parse(event.data);
  update(s);
};

ws.onclose = () => {
  document.getElementById('connectionText').textContent = 'Dashboard disconnected';
};

function update(s) {
  // Connection
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('connectionText');
  dot.className = 'status-dot' + (s.bleConnected ? ' connected' : '');
  text.className = 'connection-text' + (s.bleConnected ? ' active' : '');
  text.textContent = s.bleConnected ? 'Connected' : 'Disconnected';

  // Device
  document.getElementById('serial').textContent = s.deviceSerial;
  document.getElementById('firmware').textContent = s.firmwareVersion;
  document.getElementById('ip').textContent = s.ipAddress || '—';
  document.getElementById('battery').textContent =
    s.batteryPercent === 0xFF ? 'Unknown' : s.batteryPercent + '%';
  const usedGB = (s.storageUsedMB / 1024).toFixed(1);
  const totalGB = (s.storageTotalMB / 1024).toFixed(0);
  document.getElementById('storage').textContent = `${usedGB} / ${totalGB} GB`;

  // Operator
  const phone = document.getElementById('opPhone');
  phone.textContent = s.operatorPhone || 'Waiting...';
  phone.className = 'value' + (s.operatorPhone ? '' : ' dim');

  const height = document.getElementById('opHeight');
  height.textContent = s.operatorHeight ? s.operatorHeight + ' cm' : 'Waiting...';
  height.className = 'value' + (s.operatorHeight ? '' : ' dim');

  // WiFi
  const ssid = document.getElementById('wifiSSID');
  ssid.textContent = s.wifiSSID || 'Not provisioned';
  ssid.className = 'value' + (s.wifiSSID ? '' : ' dim');

  const pwd = document.getElementById('wifiPassword');
  pwd.textContent = s.wifiPassword || '—';
  pwd.className = 'value' + (s.wifiPassword ? '' : ' dim');

  // Recording
  const badge = document.getElementById('recBadge');
  const stateName = STATE_NAMES[s.recordingState] || 'UNKNOWN';
  badge.textContent = stateName;
  badge.className = 'badge' +
    (s.recordingState === 1 ? ' recording' : '') +
    (s.recordingState === 2 ? ' stopping' : '');

  document.getElementById('recMode').textContent = MODE_NAMES[s.recordingMode] || '—';

  const mins = Math.floor(s.recordingElapsed / 60);
  const secs = s.recordingElapsed % 60;
  document.getElementById('recElapsed').textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  const kb = s.recordingBytesKB;
  let bytesText;
  if (kb > 1000000) bytesText = (kb / 1000000).toFixed(1) + ' GB';
  else if (kb > 1000) bytesText = Math.floor(kb / 1000) + ' MB';
  else bytesText = kb + ' KB';
  document.getElementById('recBytes').textContent = bytesText;

  // Event log
  const logList = document.getElementById('logList');
  if (s.events && s.events.length > 0) {
    logList.innerHTML = s.events.map(e => {
      const t = new Date(e.time);
      const ts = t.toLocaleTimeString('en-US', { hour12: false });
      return `<div class="log-entry"><span class="log-time">${ts}</span><span class="log-msg">${e.message}</span></div>`;
    }).join('');
  }
}
