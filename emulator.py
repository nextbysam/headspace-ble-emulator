#!/usr/bin/env python3
"""
Headspace BLE Emulator — turns your Mac into a fake Headspace device.

Usage: python3 emulator.py

Starts:
  - BLE GATT peripheral (Improv WiFi + Device Manager services)
  - HTTP preview server on :8080
  - Web dashboard on :3000
"""

import asyncio
import json
import os
import socket
import struct
import time
from datetime import datetime
from pathlib import Path

from aiohttp import web
from bless import BlessServer, BlessGATTCharacteristic, GATTCharacteristicProperties, GATTAttributePermissions

# ─── UUIDs ────────────────────────────────────────────────

IMPROV_SERVICE      = '00467768-6228-2272-4663-277478268000'
IMPROV_CURRENT      = '00467768-6228-2272-4663-277478268001'
IMPROV_ERROR        = '00467768-6228-2272-4663-277478268002'
IMPROV_RPC_CMD      = '00467768-6228-2272-4663-277478268003'
IMPROV_RPC_RESULT   = '00467768-6228-2272-4663-277478268004'
IMPROV_CAPABILITIES = '00467768-6228-2272-4663-277478268005'

DEVMGR_SERVICE      = 'A0467768-6228-2272-4663-277478268100'
DEVMGR_DEVICE_INFO  = 'A0467768-6228-2272-4663-277478268101'
DEVMGR_BATTERY      = 'A0467768-6228-2272-4663-277478268102'
DEVMGR_STORAGE      = 'A0467768-6228-2272-4663-277478268103'
DEVMGR_REC_STATE    = 'A0467768-6228-2272-4663-277478268104'
DEVMGR_REC_CONTROL  = 'A0467768-6228-2272-4663-277478268105'
DEVMGR_PREVIEW      = 'A0467768-6228-2272-4663-277478268106'
DEVMGR_OPERATOR     = 'A0467768-6228-2272-4663-277478268107'

DEVICE_NAME = 'HS-TEST'

# ─── State ────────────────────────────────────────────────

class EmulatorState:
    def __init__(self, local_ip):
        self.ble_connected = False
        self.serial = 'AWL-TEST-0001'
        self.firmware = '1.0.0'
        self.ip = local_ip
        self.battery_pct = 85
        self.battery_charging = 0
        self.storage_used_mb = 10240
        self.storage_total_mb = 65536
        self.rec_state = 0x00
        self.rec_mode = 0x00
        self.rec_elapsed = 0
        self.rec_bytes_kb = 0
        self.upload_status = 0x00
        self.operator_phone = None
        self.operator_height = None
        self.wifi_ssid = None
        self.wifi_password = None
        self.improv_state = 0x02  # AUTHORIZED
        self.improv_error = 0x00
        self.events = []
        self.ws_clients = set()
        self._rec_task = None
        self.server = None  # BlessServer ref

    def log(self, msg):
        entry = {'time': datetime.now().isoformat(), 'message': msg}
        self.events.insert(0, entry)
        if len(self.events) > 100:
            self.events.pop()
        print(f'[EMU] {msg}')
        self.broadcast()

    def snapshot(self):
        return {
            'bleConnected': self.ble_connected,
            'deviceSerial': self.serial,
            'firmwareVersion': self.firmware,
            'ipAddress': self.ip,
            'batteryPercent': self.battery_pct,
            'batteryCharging': self.battery_charging,
            'storageUsedMB': self.storage_used_mb,
            'storageTotalMB': self.storage_total_mb,
            'recordingState': self.rec_state,
            'recordingMode': self.rec_mode,
            'recordingElapsed': self.rec_elapsed,
            'recordingBytesKB': self.rec_bytes_kb,
            'uploadStatus': self.upload_status,
            'operatorPhone': self.operator_phone,
            'operatorHeight': self.operator_height,
            'wifiSSID': self.wifi_ssid,
            'wifiPassword': self.wifi_password,
            'improvState': self.improv_state,
            'improvError': self.improv_error,
            'events': self.events[:50],
        }

    def broadcast(self):
        data = json.dumps(self.snapshot())
        for ws in list(self.ws_clients):
            asyncio.ensure_future(ws.send_str(data))

    # ─── Encoding helpers ──────────────────────────────

    def encode_device_info(self):
        parts = []
        for s in [self.serial, self.firmware, self.ip]:
            b = s.encode('utf-8')
            parts.append(bytes([len(b)]) + b)
        return b''.join(parts)

    def encode_storage(self):
        return struct.pack('<II', self.storage_used_mb, self.storage_total_mb)

    def encode_recording_state(self):
        return struct.pack('<BBIHB',
            self.rec_state, self.rec_mode,
            self.rec_elapsed, self.rec_bytes_kb,
            self.upload_status)

    def encode_preview_info(self):
        if not self.ip:
            return bytes([0])
        url = f'http://{self.ip}:8080/preview.jpg'.encode('utf-8')
        return bytes([len(url)]) + url

    # ─── Actions ───────────────────────────────────────

    def start_recording(self, mode):
        self.rec_state = 0x01
        self.rec_mode = mode
        self.rec_elapsed = 0
        self.rec_bytes_kb = 0
        self.upload_status = 0x01 if mode == 0x02 else 0x00
        mode_str = 'local' if mode == 0x01 else 'live_stream'
        self.log(f'Recording started (mode: {mode_str})')
        self._update_ble_recording_state()
        self._rec_task = asyncio.ensure_future(self._recording_loop())

    async def _recording_loop(self):
        while self.rec_state == 0x01:
            await asyncio.sleep(2)
            if self.rec_state != 0x01:
                break
            self.rec_elapsed += 2
            self.rec_bytes_kb += 3000
            self._update_ble_recording_state()
            self.broadcast()

    def stop_recording(self):
        self.rec_state = 0x02
        self.log('Recording stopping...')
        self._update_ble_recording_state()
        asyncio.ensure_future(self._finish_stop())

    async def _finish_stop(self):
        await asyncio.sleep(0.5)
        self.rec_state = 0x00
        self.rec_mode = 0x00
        self.rec_elapsed = 0
        self.rec_bytes_kb = 0
        self.upload_status = 0x00
        self.log('Recording stopped')
        self._update_ble_recording_state()
        self.broadcast()

    def _update_ble_recording_state(self):
        if self.server:
            try:
                self.server.get_characteristic(DEVMGR_REC_STATE).value = self.encode_recording_state()
                self.server.update_value(DEVMGR_SERVICE, DEVMGR_REC_STATE)
            except Exception:
                pass

# ─── BLE Write Handler ────────────────────────────────────

def handle_write(state):
    def write_request(characteristic, value, **kwargs):
        value = bytes(value)  # convert memoryview to bytes
        uuid = str(characteristic.uuid).upper()

        if uuid == IMPROV_RPC_CMD.upper():
            # Parse WiFi credentials
            if len(value) < 4 or value[0] != 0x01:
                state.log('Invalid RPC command')
                return
            pos = 2
            ssid_len = value[pos]; pos += 1
            ssid = value[pos:pos+ssid_len].decode('utf-8'); pos += ssid_len
            pwd_len = value[pos]; pos += 1
            password = value[pos:pos+pwd_len].decode('utf-8')
            state.wifi_ssid = ssid
            state.wifi_password = password
            state.log(f'WiFi credentials: SSID="{ssid}"')

            # Simulate provisioning
            async def provision():
                await asyncio.sleep(2)
                state.improv_state = 0x04
                state.log(f'WiFi provisioned — IP: {state.ip}')

                # Update current state characteristic
                state.server.get_characteristic(IMPROV_CURRENT).value = bytes([0x04])
                state.server.update_value(IMPROV_SERVICE, IMPROV_CURRENT)

                # Send RPC result with IP
                ip_bytes = state.ip.encode('utf-8')
                result = bytes([0x01, len(ip_bytes) + 1, len(ip_bytes)]) + ip_bytes
                state.server.get_characteristic(IMPROV_RPC_RESULT).value = result
                state.server.update_value(IMPROV_SERVICE, IMPROV_RPC_RESULT)
                state.broadcast()

            asyncio.ensure_future(provision())

        elif uuid == DEVMGR_REC_CONTROL.upper():
            if len(value) < 1:
                return
            cmd = value[0]
            if cmd == 0x01 and len(value) >= 2:
                state.start_recording(value[1])
            elif cmd == 0x02:
                state.stop_recording()

        elif uuid == DEVMGR_OPERATOR.upper():
            if len(value) < 3:
                state.log('Operator info too short')
                return
            phone_len = value[0]
            if 1 + phone_len + 2 > len(value):
                state.log('Operator info invalid')
                return
            phone = value[1:1+phone_len].decode('utf-8')
            height = struct.unpack('<H', value[1+phone_len:1+phone_len+2])[0]
            state.operator_phone = phone
            state.operator_height = height
            state.log(f'Operator info: phone={phone}, height={height}cm')

    return write_request

# ─── BLE Read Handler ─────────────────────────────────────

def handle_read(state):
    def read_request(characteristic, **kwargs):
        uuid = str(characteristic.uuid).upper()

        if uuid == IMPROV_CURRENT.upper():
            characteristic.value = bytes([state.improv_state])
        elif uuid == IMPROV_ERROR.upper():
            characteristic.value = bytes([state.improv_error])
        elif uuid == DEVMGR_DEVICE_INFO.upper():
            characteristic.value = state.encode_device_info()
        elif uuid == DEVMGR_BATTERY.upper():
            characteristic.value = bytes([state.battery_pct, state.battery_charging])
        elif uuid == DEVMGR_STORAGE.upper():
            characteristic.value = state.encode_storage()
        elif uuid == DEVMGR_REC_STATE.upper():
            characteristic.value = state.encode_recording_state()
        elif uuid == DEVMGR_PREVIEW.upper():
            characteristic.value = state.encode_preview_info()

        return characteristic.value

    return read_request

# ─── BLE Setup ────────────────────────────────────────────

async def setup_ble(state):
    server = BlessServer(name=DEVICE_NAME)
    state.server = server

    server.read_request_func = handle_read(state)
    server.write_request_func = handle_write(state)

    # CoreBluetooth rule: characteristics with notify (or write) must have value=None (dynamic).
    # Only pure read-only characteristics can have cached values.
    RN = GATTCharacteristicProperties.read | GATTCharacteristicProperties.notify
    R  = GATTCharacteristicProperties.read
    W  = GATTCharacteristicProperties.write
    RP = GATTAttributePermissions.readable
    WP = GATTAttributePermissions.writeable

    await server.add_new_service(IMPROV_SERVICE)
    await server.add_new_characteristic(IMPROV_SERVICE, IMPROV_CURRENT, RN, None, RP)
    await server.add_new_characteristic(IMPROV_SERVICE, IMPROV_ERROR, RN, None, RP)
    await server.add_new_characteristic(IMPROV_SERVICE, IMPROV_RPC_CMD, W, None, WP)
    await server.add_new_characteristic(IMPROV_SERVICE, IMPROV_RPC_RESULT, RN, None, RP)
    await server.add_new_characteristic(IMPROV_SERVICE, IMPROV_CAPABILITIES, R, bytes([0x01]), RP)

    await server.add_new_service(DEVMGR_SERVICE)
    await server.add_new_characteristic(DEVMGR_SERVICE, DEVMGR_DEVICE_INFO, R, state.encode_device_info(), RP)
    await server.add_new_characteristic(DEVMGR_SERVICE, DEVMGR_BATTERY, RN, None, RP)
    await server.add_new_characteristic(DEVMGR_SERVICE, DEVMGR_STORAGE, RN, None, RP)
    await server.add_new_characteristic(DEVMGR_SERVICE, DEVMGR_REC_STATE, RN, None, RP)
    await server.add_new_characteristic(DEVMGR_SERVICE, DEVMGR_REC_CONTROL, W, None, WP)
    await server.add_new_characteristic(DEVMGR_SERVICE, DEVMGR_PREVIEW, R, state.encode_preview_info(), RP)
    await server.add_new_characteristic(DEVMGR_SERVICE, DEVMGR_OPERATOR, W, None, WP)

    await server.start(prioritize_local_name=False)

    # Set initial values on dynamic characteristics (after start, so CoreBluetooth accepts them)
    server.get_characteristic(IMPROV_CURRENT).value = bytes([0x02])
    server.get_characteristic(IMPROV_ERROR).value = bytes([0x00])
    server.get_characteristic(IMPROV_RPC_RESULT).value = bytes([0x00])
    server.get_characteristic(DEVMGR_BATTERY).value = bytes([state.battery_pct, state.battery_charging])
    server.get_characteristic(DEVMGR_STORAGE).value = state.encode_storage()
    server.get_characteristic(DEVMGR_REC_STATE).value = state.encode_recording_state()

    state.log(f'BLE advertising as "{DEVICE_NAME}" (2 services, 12 characteristics)')

    # Periodic battery/storage notifications
    async def notify_loop():
        while True:
            await asyncio.sleep(5)
            try:
                server.get_characteristic(DEVMGR_BATTERY).value = bytes([state.battery_pct, state.battery_charging])
                server.update_value(DEVMGR_SERVICE, DEVMGR_BATTERY)
                server.get_characteristic(DEVMGR_STORAGE).value = state.encode_storage()
                server.update_value(DEVMGR_SERVICE, DEVMGR_STORAGE)
            except Exception:
                pass

    asyncio.ensure_future(notify_loop())

# ─── HTTP + Dashboard ─────────────────────────────────────

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

async def start_http(state, port=8080):
    app = web.Application()
    test_img = Path(__file__).parent / 'assets' / 'test-preview.jpg'

    async def preview(request):
        if state.rec_state != 0x01:
            return web.Response(text='Not recording.\r\n', status=503)
        if test_img.exists():
            return web.FileResponse(test_img, headers={'Content-Type': 'image/jpeg'})
        return web.Response(text='No preview available', status=503)

    app.router.add_get('/preview.jpg', preview)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    print(f'[HTTP] Preview server on port {port}')

async def start_dashboard(state, port=3000):
    app = web.Application()
    static_dir = Path(__file__).parent / 'src' / 'dashboard' / 'public'

    async def ws_handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        state.ws_clients.add(ws)
        await ws.send_str(json.dumps(state.snapshot()))
        try:
            async for msg in ws:
                pass
        finally:
            state.ws_clients.discard(ws)
        return ws

    async def index_handler(request):
        return web.FileResponse(static_dir / 'index.html')

    app.router.add_get('/ws', ws_handler)
    app.router.add_get('/', index_handler)
    app.router.add_static('/static', static_dir)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    print(f'[DASH] Dashboard on http://localhost:{port}')

# ─── Main ─────────────────────────────────────────────────

async def main():
    ip = get_local_ip()
    print()
    print('  Headspace BLE Emulator')
    print('  ──────────────────────')
    print(f'  Local IP:   {ip}')
    print()

    state = EmulatorState(ip)
    await start_http(state, 8080)
    await start_dashboard(state, 3000)
    await setup_ble(state)

    # Keep running
    while True:
        await asyncio.sleep(3600)

if __name__ == '__main__':
    asyncio.run(main())
