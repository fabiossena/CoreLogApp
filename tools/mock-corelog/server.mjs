/**
 * CoreLog contract mock — implements the REST + SignalR surface documented in
 * `docs/api-contract.md` so the dashboard can be exercised end-to-end without
 * the (currently incomplete) CoreLog backend.
 *
 * Zero dependencies: Node's built-in http/WebSocket (hand-rolled, RFC 6455)
 * is enough for the SignalR JSON protocol used by `@microsoft/signalr`.
 *
 *   node tools/mock-corelog/server.mjs [--port 8099] [--quiet] [--no-live]
 *
 * Endpoints
 *   GET    /api/devices
 *   GET    /api/panic?acknowledged&from&to&page&size
 *   POST   /api/panic
 *   POST   /api/panic/{panicId}/ack
 *   POST   /api/devices/{deviceId}/commands
 *   GET    /api/devices/{deviceId}/commands
 *   POST   /api/devices/{deviceId}/commands/{commandId}/ack
 *   POST   /api/trackers                        GET /api/trackers
 *   DELETE /api/trackers/{trackerId}
 *   POST   /api/tracking/events
 *   GET    /api/tracking/{vehicleId}/positions  GET /api/tracking/{vehicleId}/last
 *   GET    /api/trips/{tripId}/positions
 *   POST   /hubs/tracking/negotiate             WS /hubs/tracking?id=<token>
 */

import http from 'node:http';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// CLI / config
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index !== -1 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const PORT = Number(getArg('--port', process.env.MOCK_CORELOG_PORT ?? 8099));
const QUIET = args.includes('--quiet');
const LIVE = !args.includes('--no-live');
const TICK_MS = 3000;
const ACK_DELAY_MS = 1500;

const log = (...values) => {
  if (!QUIET) {
    console.log(new Date().toISOString(), ...values);
  }
};

// ---------------------------------------------------------------------------
// In-memory data
// ---------------------------------------------------------------------------
const nowIso = () => new Date().toISOString();
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const uuid = () => crypto.randomUUID();

const DEVICE_SEED = [
  { vehicle_id: 'VEH-001', display_name: 'Van 01', source: 'MobileApp', region: 'Porto', trip_id: '19ec5ed4-98f2-4c83-8f16-1794b336e7fd' },
  { vehicle_id: 'VEH-002', display_name: 'Van 02', source: 'MobileApp', region: 'Porto', trip_id: '2d1f7a3e-1c44-4a9b-9d55-6f0a1b2c3d4e' },
  { vehicle_id: 'VEH-003', display_name: 'Truck 03', source: 'Sascar', region: 'Lisbon', trip_id: '3e2a8b4f-2d55-4b0c-8e66-7a1b2c3d4e5f' },
  { vehicle_id: 'VEH-004', display_name: 'Bike 04', source: 'ChineseGPS', region: 'Lisbon', trip_id: null },
  { vehicle_id: 'VEH-005', display_name: 'Support 05', source: 'MobileApp', region: 'Braga', trip_id: null },
];

/** Mutable fleet state. */
const devices = DEVICE_SEED.map((device, index) => {
  const lat = 41.1496 + index * 0.012;
  const lng = -8.611 - index * 0.009;
  const stale = index === 3 ? 2 * 60 * 60 * 1000 : index === 4 ? 9 * 60 * 1000 : 0;
  return {
    ...device,
    status: index === 3 ? 'Offline' : index === 4 ? 'PossiblyOffline' : 'Online',
    tracking_enabled: index !== 3,
    latitude: lat,
    longitude: lng,
    speed_kmh: 40 + index * 5,
    last_position_at_utc: stale > 0 ? isoAgo(stale) : nowIso(),
  };
});

/** @type {Map<string, Array<object>>} vehicle_id -> positions (newest last) */
const positionsByVehicle = new Map();
/** @type {Array<object>} */
const panics = [];
/** @type {Map<string, Array<object>>} device_id -> commands */
const commandsByDevice = new Map();
/** @type {Array<object>} */
const trackers = [];

function makePosition(device, timestamp = nowIso(), jitter = 0) {
  return {
    event_id: uuid(),
    vehicle_id: device.vehicle_id,
    latitude: Number((device.latitude + jitter).toFixed(6)),
    longitude: Number((device.longitude + jitter).toFixed(6)),
    timestamp_utc: timestamp,
    speed_kmh: Number(device.speed_kmh.toFixed(1)),
    source: device.source,
    trip_id: device.trip_id ?? null,
  };
}

function seedHistory() {
  for (const device of devices) {
    const history = [];
    if (device.vehicle_id !== 'VEH-004') {
      for (let i = 60; i >= 1; i -= 1) {
        const point = makePosition(device, isoAgo(i * 30_000), Math.sin(i / 6) * 0.002);
        history.push(point);
      }
    }
    positionsByVehicle.set(device.vehicle_id, history);
  }
}

function seedPanics() {
  const first = devices[0];
  panics.push({
    panic_id: uuid(),
    event_id: uuid(),
    vehicle_id: first.vehicle_id,
    timestamp_utc: isoAgo(4 * 60_000),
    last_known_position: {
      latitude: first.latitude,
      longitude: first.longitude,
      timestamp_utc: isoAgo(4 * 60_000 + 20_000),
    },
    source: first.source,
    acknowledged: false,
    acknowledged_at_utc: null,
    acknowledged_by: null,
  });
  const second = devices[1];
  panics.push({
    panic_id: uuid(),
    event_id: uuid(),
    vehicle_id: second.vehicle_id,
    timestamp_utc: isoAgo(2 * 60 * 60_000),
    last_known_position: {
      latitude: second.latitude,
      longitude: second.longitude,
      timestamp_utc: isoAgo(2 * 60 * 60_000 + 15_000),
    },
    source: second.source,
    acknowledged: true,
    acknowledged_at_utc: isoAgo(110 * 60_000),
    acknowledged_by: 'fabio.sena',
  });
}

function seedTrackers() {
  trackers.push(
    {
      tracker_id: uuid(),
      type: 'Sascar',
      name: 'Fleet A — plate 12-AB-34',
      vehicle_id: 'VEH-010',
      polling_interval_seconds: 30,
      credentials: { plate: '12-AB-34', integration_user: 'corelog' },
      enabled: true,
      created_at_utc: isoAgo(3 * 24 * 60 * 60_000),
    },
    {
      tracker_id: uuid(),
      type: 'ChineseGPS',
      name: 'Traccar — chip 8900',
      vehicle_id: 'VEH-011',
      polling_interval_seconds: 30,
      credentials: { traccar_device_id: 'TRC-118', chip_model: 'Concox GT06' },
      enabled: true,
      created_at_utc: isoAgo(2 * 24 * 60 * 60_000),
    },
    {
      tracker_id: uuid(),
      type: 'MobileApp',
      name: 'Mobile app — VEH-001',
      vehicle_id: 'VEH-001',
      polling_interval_seconds: 60,
      credentials: {},
      enabled: true,
      created_at_utc: isoAgo(24 * 60 * 60_000),
    },
  );
}

seedHistory();
seedPanics();
seedTrackers();

// ---------------------------------------------------------------------------
// Public projections
// ---------------------------------------------------------------------------
function deviceView(device) {
  const history = positionsByVehicle.get(device.vehicle_id) ?? [];
  const last = history.at(-1) ?? null;
  return {
    vehicle_id: device.vehicle_id,
    display_name: device.display_name,
    status: device.status,
    tracking_enabled: device.tracking_enabled,
    source: device.source,
    last_position_at_utc: last?.timestamp_utc ?? null,
    last_position: last
      ? {
          latitude: last.latitude,
          longitude: last.longitude,
          timestamp_utc: last.timestamp_utc,
          ...(last.speed_kmh != null ? { speed_kmh: last.speed_kmh } : {}),
        }
      : null,
    region: device.region,
    trip_id: device.trip_id,
  };
}

function paginate(items, page, size, extra = {}) {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(1000, Math.max(1, size));
  const start = (safePage - 1) * safeSize;
  return {
    page: safePage,
    size: safeSize,
    total_count: items.length,
    total_pages: Math.max(1, Math.ceil(items.length / safeSize)),
    ...extra,
    items: items.slice(start, start + safeSize),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, body, origin = '*') {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendNoContent(res, origin = '*') {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Realtime: SignalR JSON protocol over a hand-rolled WebSocket server
// ---------------------------------------------------------------------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** @type {Map<string, {socket: import('node:net').Socket, groups: Set<string>, handshaken: boolean, buffer: Buffer}>} */
const connections = new Map();

function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Extracts complete frames from a buffer; returns [frames, remainder]. */
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length - offset < headerLength + maskLength + length) break;
    const mask = masked
      ? buffer.subarray(offset + headerLength, offset + headerLength + 4)
      : null;
    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }
    frames.push({ fin, opcode, payload });
    offset = payloadStart + length;
  }
  return [frames, buffer.subarray(offset)];
}

function wsSend(connection, text) {
  try {
    connection.socket.write(encodeFrame(text));
  } catch (error) {
    log('ws write failed:', error.message);
  }
}

function signalrSend(connection, message) {
  wsSend(connection, JSON.stringify(message) + '\u001e');
}

function broadcast(group, target, payload) {
  const message = { type: 1, target, arguments: [payload] };
  for (const connection of connections.values()) {
    if (connection.handshaken && connection.groups.has(group)) {
      signalrSend(connection, message);
    }
  }
}

function handleSignalrMessage(connection, text) {
  for (const record of text.split('\u001e')) {
    if (record.trim() === '') continue;
    let message;
    try {
      message = JSON.parse(record);
    } catch {
      continue;
    }
    if (!connection.handshaken) {
      connection.handshaken = true;
      wsSend(connection, '{}\u001e');
      continue;
    }
    if (message.type !== 1) continue; // only Invocation is expected from the client
    const { invocationId, target, arguments: invocationArgs = [] } = message;
    if (target === 'JoinAll') {
      connection.groups.add('all-devices');
      log('hub: JoinAll');
    } else if (target === 'JoinVehicle') {
      const vehicleId = String(invocationArgs[0] ?? '');
      connection.groups.add(`device-${vehicleId}`);
      log(`hub: JoinVehicle(${vehicleId})`);
    }
    if (invocationId !== undefined) {
      signalrSend(connection, { type: 3, invocationId });
    }
  }
}

function handleUpgrade(req, socket) {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('id');
  if (url.pathname !== '/hubs/tracking' || token === null) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const key = req.headers['sec-websocket-key'];
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  const connection = { socket, groups: new Set(), handshaken: false, buffer: Buffer.alloc(0) };
  connections.set(token, connection);

  socket.on('data', (data) => {
    connection.buffer = Buffer.concat([connection.buffer, data]);
    const [frames, remainder] = decodeFrames(connection.buffer);
    connection.buffer = remainder;
    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, frame.payload.length]), frame.payload]));
        continue;
      }
      if (frame.opcode === 0x1) {
        handleSignalrMessage(connection, frame.payload.toString('utf8'));
      }
    }
  });

  const cleanup = () => {
    connections.delete(token);
    log('hub: disconnected');
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
  log('hub: connected');
}

/** Negotiate: advertises WebSockets only so the client picks our transport. */
function handleNegotiate(res, origin) {
  const connectionId = crypto.randomBytes(16).toString('base64url');
  const connectionToken = crypto.randomBytes(16).toString('base64url');
  sendJson(
    res,
    200,
    {
      negotiateVersion: 1,
      connectionId,
      connectionToken,
      availableTransports: [
        { transport: 'WebSockets', transferFormats: ['Text', 'Binary'] },
      ],
    },
    origin,
  );
}

// ---------------------------------------------------------------------------
// Live simulation
// ---------------------------------------------------------------------------
let tick = 0;
function simulate() {
  tick += 1;
  const moving = devices.filter((device) => device.status === 'Online' && device.vehicle_id !== 'VEH-004');
  for (const device of moving) {
    // Smooth pseudo-random walk around the seed point.
    device.latitude += Math.sin((tick + device.display_name.length) / 4) * 0.00035;
    device.longitude += Math.cos((tick + device.display_name.length) / 5) * 0.00035;
    device.speed_kmh = Math.max(5, Math.min(95, device.speed_kmh + (Math.random() - 0.5) * 8));

    const position = makePosition(device);
    const history = positionsByVehicle.get(device.vehicle_id) ?? [];
    history.push(position);
    if (history.length > 2000) history.shift();
    positionsByVehicle.set(device.vehicle_id, history);
    device.last_position_at_utc = position.timestamp_utc;

    broadcast('all-devices', 'PositionReceived', position);
    broadcast(`device-${device.vehicle_id}`, 'PositionReceived', position);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? '*';
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    sendNoContent(res, origin);
    return;
  }

  try {
    // -- negotiate ---------------------------------------------------------
    if (path === '/hubs/tracking/negotiate' && method === 'POST') {
      handleNegotiate(res, origin);
      return;
    }

    // -- health ------------------------------------------------------------
    if (path === '/health' && method === 'GET') {
      sendJson(res, 200, { status: 'healthy', service: 'mock-corelog', utc: nowIso() }, origin);
      return;
    }

    // -- devices -----------------------------------------------------------
    if (path === '/api/devices' && method === 'GET') {
      sendJson(res, 200, { items: devices.map(deviceView) }, origin);
      return;
    }

    const deviceMatch = /^\/api\/devices\/([^/]+)$/.exec(path);
    if (deviceMatch && method === 'GET') {
      const device = devices.find((candidate) => candidate.vehicle_id === decodeURIComponent(deviceMatch[1]));
      if (device === undefined) {
        sendJson(res, 404, { title: `Device '${deviceMatch[1]}' not found.`, status: 404 }, origin);
        return;
      }
      sendJson(res, 200, deviceView(device), origin);
      return;
    }

    // -- panics ------------------------------------------------------------
    if (path === '/api/panic' && method === 'GET') {
      const acknowledged = url.searchParams.get('acknowledged');
      let items = [...panics];
      if (acknowledged === 'true' || acknowledged === 'false') {
        items = items.filter((panic) => panic.acknowledged === (acknowledged === 'true'));
      }
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (from) items = items.filter((panic) => Date.parse(panic.timestamp_utc) >= Date.parse(from));
      if (to) items = items.filter((panic) => Date.parse(panic.timestamp_utc) <= Date.parse(to));
      items.sort((a, b) => Date.parse(b.timestamp_utc) - Date.parse(a.timestamp_utc));
      const page = Number(url.searchParams.get('page') ?? 1);
      const size = Number(url.searchParams.get('size') ?? 50);
      sendJson(res, 200, paginate(items, page, size), origin);
      return;
    }

    if (path === '/api/panic' && method === 'POST') {
      const body = await readJson(req);
      if (!body || typeof body.vehicle_id !== 'string') {
        sendJson(res, 400, { title: 'vehicle_id is required.', status: 400 }, origin);
        return;
      }
      const panic = {
        panic_id: uuid(),
        event_id: body.event_id ?? uuid(),
        vehicle_id: body.vehicle_id,
        timestamp_utc: body.timestamp_utc ?? nowIso(),
        last_known_position: body.last_known_position ?? null,
        source: body.source ?? 'MobileApp',
        acknowledged: false,
        acknowledged_at_utc: null,
        acknowledged_by: null,
      };
      panics.push(panic);
      broadcast('all-devices', 'PanicReceived', {
        panic_id: panic.panic_id,
        event_id: panic.event_id,
        vehicle_id: panic.vehicle_id,
        timestamp_utc: panic.timestamp_utc,
        last_known_position: {
          latitude: panic.last_known_position?.latitude ?? 0,
          longitude: panic.last_known_position?.longitude ?? 0,
        },
        source: panic.source,
      });
      log(`panic created for ${panic.vehicle_id}`);
      sendJson(res, 201, { panic_id: panic.panic_id }, origin);
      return;
    }

    const panicAckMatch = /^\/api\/panic\/([^/]+)\/ack$/.exec(path);
    if (panicAckMatch && method === 'POST') {
      const panic = panics.find((candidate) => candidate.panic_id === decodeURIComponent(panicAckMatch[1]));
      if (panic === undefined) {
        sendJson(res, 404, { title: 'Panic not found.', status: 404 }, origin);
        return;
      }
      const body = (await readJson(req)) ?? {};
      panic.acknowledged = true;
      panic.acknowledged_at_utc = nowIso();
      panic.acknowledged_by = body.operator ?? 'unknown';
      log(`panic ${panic.panic_id} acknowledged by ${panic.acknowledged_by}`);
      sendJson(res, 200, panic, origin);
      return;
    }

    // -- commands ----------------------------------------------------------
    const commandsMatch = /^\/api\/devices\/([^/]+)\/commands$/.exec(path);
    if (commandsMatch) {
      const deviceId = decodeURIComponent(commandsMatch[1]);
      const device = devices.find((candidate) => candidate.vehicle_id === deviceId);
      if (device === undefined) {
        sendJson(res, 404, { title: `Device '${deviceId}' not found.`, status: 404 }, origin);
        return;
      }
      const commands = commandsByDevice.get(deviceId) ?? [];
      if (method === 'GET') {
        sendJson(res, 200, { items: [...commands].reverse() }, origin);
        return;
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const validTypes = ['SET_FREQUENCY', 'SILENCE', 'REACTIVATE', 'REQUEST_IMMEDIATE_POSITION'];
        if (!body || !validTypes.includes(body.command_type)) {
          sendJson(res, 400, { title: 'Invalid command_type.', status: 400 }, origin);
          return;
        }
        const command = {
          command_id: uuid(),
          device_id: deviceId,
          command_type: body.command_type,
          payload: body.payload ?? {},
          status: 'Pending',
          created_at_utc: nowIso(),
          acknowledged_at_utc: null,
          silenced_until_utc:
            body.command_type === 'SILENCE'
              ? new Date(Date.now() + Number(body.payload?.duration_seconds ?? 600) * 1000).toISOString()
              : null,
          error: null,
        };
        commands.push(command);
        commandsByDevice.set(deviceId, commands);
        log(`command ${command.command_type} dispatched to ${deviceId}`);

        setTimeout(() => {
          command.status = 'Acked';
          command.acknowledged_at_utc = nowIso();
          const ack = {
            command_id: command.command_id,
            device_id: command.device_id,
            status: 'Acked',
            acknowledged_at_utc: command.acknowledged_at_utc,
          };
          broadcast(`device-${deviceId}`, 'CommandAcked', ack);
          broadcast('all-devices', 'CommandAcked', ack);
          log(`command ${command.command_id} acked`);
        }, ACK_DELAY_MS);

        sendJson(res, 201, command, origin);
        return;
      }
    }

    const commandAckMatch = /^\/api\/devices\/([^/]+)\/commands\/([^/]+)\/ack$/.exec(path);
    if (commandAckMatch && method === 'POST') {
      const deviceId = decodeURIComponent(commandAckMatch[1]);
      const commandId = decodeURIComponent(commandAckMatch[2]);
      const command = (commandsByDevice.get(deviceId) ?? []).find(
        (candidate) => candidate.command_id === commandId,
      );
      if (command === undefined) {
        sendJson(res, 404, { title: 'Command not found.', status: 404 }, origin);
        return;
      }
      const body = (await readJson(req)) ?? {};
      command.status = body.result === 'Failed' ? 'Failed' : 'Acked';
      command.acknowledged_at_utc = nowIso();
      command.error = body.message ?? null;
      const ack = {
        command_id: command.command_id,
        device_id: command.device_id,
        status: command.status,
        acknowledged_at_utc: command.acknowledged_at_utc,
      };
      broadcast(`device-${deviceId}`, 'CommandAcked', ack);
      broadcast('all-devices', 'CommandAcked', ack);
      sendJson(res, 200, { status: 'ok' }, origin);
      return;
    }

    // -- trackers ----------------------------------------------------------
    if (path === '/api/trackers' && method === 'GET') {
      sendJson(res, 200, { items: trackers }, origin);
      return;
    }
    if (path === '/api/trackers' && method === 'POST') {
      const body = await readJson(req);
      const validTypes = ['Sascar', 'Omnilink', 'Autotrac', 'ChineseGPS', 'MobileApp'];
      if (!body || !validTypes.includes(body.type) || typeof body.vehicle_id !== 'string') {
        sendJson(res, 400, { title: 'Invalid tracker payload.', status: 400 }, origin);
        return;
      }
      const tracker = {
        tracker_id: uuid(),
        type: body.type,
        name: body.name ?? `${body.type} — ${body.vehicle_id}`,
        vehicle_id: body.vehicle_id,
        polling_interval_seconds: Number(body.polling_interval_seconds ?? 30),
        credentials: body.credentials ?? {},
        enabled: body.enabled !== false,
        created_at_utc: nowIso(),
      };
      trackers.push(tracker);
      log(`tracker ${tracker.type} registered for ${tracker.vehicle_id}`);
      sendJson(
        res,
        201,
        { tracker_id: tracker.tracker_id, type: tracker.type, vehicle_id: tracker.vehicle_id },
        origin,
      );
      return;
    }

    const trackerMatch = /^\/api\/trackers\/([^/]+)$/.exec(path);
    if (trackerMatch && method === 'DELETE') {
      const trackerId = decodeURIComponent(trackerMatch[1]);
      const index = trackers.findIndex((candidate) => candidate.tracker_id === trackerId);
      if (index === -1) {
        sendJson(res, 404, { title: 'Tracker not found.', status: 404 }, origin);
        return;
      }
      trackers.splice(index, 1);
      sendNoContent(res, origin);
      return;
    }

    // -- ingestion ---------------------------------------------------------
    if (path === '/api/tracking/events' && method === 'POST') {
      const body = await readJson(req);
      const events = Array.isArray(body) ? body : [];
      let accepted = 0;
      for (const event of events) {
        if (typeof event.vehicle_id !== 'string' || !Number.isFinite(event.latitude) || !Number.isFinite(event.longitude)) {
          continue;
        }
        const device = devices.find((candidate) => candidate.vehicle_id === event.vehicle_id);
        if (device === undefined) continue;
        const position = {
          event_id: uuid(),
          vehicle_id: event.vehicle_id,
          latitude: event.latitude,
          longitude: event.longitude,
          timestamp_utc: event.timestamp_utc ?? nowIso(),
          speed_kmh: event.speed_kmh ?? null,
          source: 'MobileApp',
          trip_id: device.trip_id ?? null,
        };
        const history = positionsByVehicle.get(event.vehicle_id) ?? [];
        history.push(position);
        positionsByVehicle.set(event.vehicle_id, history);
        device.last_position_at_utc = position.timestamp_utc;
        broadcast('all-devices', 'PositionReceived', position);
        broadcast(`device-${event.vehicle_id}`, 'PositionReceived', position);
        accepted += 1;
      }
      sendJson(res, 202, { accepted, rejected: events.length - accepted }, origin);
      if (accepted > 0) {
        log(`ingestion: accepted ${accepted}/${events.length} position(s)`);
      }
      return;
    }

    // -- history -----------------------------------------------------------
    const positionsMatch = /^\/api\/tracking\/([^/]+)\/positions$/.exec(path);
    if (positionsMatch && method === 'GET') {
      const vehicleId = decodeURIComponent(positionsMatch[1]);
      let items = [...(positionsByVehicle.get(vehicleId) ?? [])];
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (from) items = items.filter((position) => Date.parse(position.timestamp_utc) >= Date.parse(from));
      if (to) items = items.filter((position) => Date.parse(position.timestamp_utc) <= Date.parse(to));
      const page = Number(url.searchParams.get('page') ?? 1);
      const size = Number(url.searchParams.get('size') ?? 500);
      sendJson(
        res,
        200,
        paginate(items, page, size, {
          from_utc: from ?? isoAgo(24 * 60 * 60_000),
          to_utc: to ?? nowIso(),
        }),
        origin,
      );
      return;
    }

    const lastMatch = /^\/api\/tracking\/([^/]+)\/last$/.exec(path);
    if (lastMatch && method === 'GET') {
      const vehicleId = decodeURIComponent(lastMatch[1]);
      const history = positionsByVehicle.get(vehicleId) ?? [];
      const last = history.at(-1);
      if (last === undefined) {
        sendJson(res, 404, { error: `No positions recorded for vehicle '${vehicleId}'.` }, origin);
        return;
      }
      sendJson(res, 200, last, origin);
      return;
    }

    const tripPositionsMatch = /^\/api\/trips\/([^/]+)\/positions$/.exec(path);
    if (tripPositionsMatch && method === 'GET') {
      const tripId = decodeURIComponent(tripPositionsMatch[1]);
      const items = [];
      for (const history of positionsByVehicle.values()) {
        items.push(...history.filter((position) => position.trip_id === tripId));
      }
      items.sort((a, b) => Date.parse(a.timestamp_utc) - Date.parse(b.timestamp_utc));
      const page = Number(url.searchParams.get('page') ?? 1);
      const size = Number(url.searchParams.get('size') ?? 100);
      sendJson(res, 200, paginate(items, page, size), origin);
      return;
    }

    sendJson(res, 404, { title: `No route for ${method} ${path}.`, status: 404 }, origin);
  } catch (error) {
    log('request failed:', error);
    sendJson(res, 500, { title: 'Mock server error.', status: 500, detail: String(error) }, origin);
  }
});

server.on('upgrade', handleUpgrade);

if (LIVE) {
  setInterval(simulate, TICK_MS).unref?.();
}

server.listen(PORT, () => {
  log(`mock CoreLog listening on http://localhost:${PORT}`);
  log(`  REST      /api/devices · /api/panic · /api/trackers · /api/tracking/* · /api/trips/*`);
  log(`  SignalR   /hubs/tracking  (WebSockets, JSON protocol)`);
  log(`  Live sim  ${LIVE ? `every ${TICK_MS} ms` : 'disabled'} · command ack in ${ACK_DELAY_MS} ms`);
});

const shutdown = () => {
  log('shutting down…');
  for (const connection of connections.values()) {
    try {
      connection.socket.end();
    } catch {
      // ignore
    }
  }
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
