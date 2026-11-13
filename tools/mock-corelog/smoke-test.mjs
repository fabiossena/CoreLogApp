/**
 * Smoke test for the CoreLog contract mock.
 *
 * Exercises the dashboard's exact flows with the same SignalR client the web
 * app uses: connect, JoinAll, receive live positions, dispatch a command over
 * REST and wait for `CommandAcked`, raise/ack a panic, and register/delete a
 * tracker.
 *
 *   node tools/mock-corelog/smoke-test.mjs [baseUrl]
 */

import { createRequire } from 'node:module';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { HubConnectionBuilder, LogLevel } = require('@microsoft/signalr');

const baseUrl = process.argv[2] ?? 'http://localhost:8099';
const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const json = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = response.status === 204 ? undefined : await response.json();
  return { status: response.status, body };
};

const post = (path, body) =>
  json(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const received = { positions: 0, panics: [], acks: [] };

const connection = new HubConnectionBuilder()
  .withUrl(`${baseUrl}/hubs/tracking`)
  .configureLogging(LogLevel.None)
  .build();

connection.on('PositionReceived', () => {
  received.positions += 1;
});
connection.on('PanicReceived', (payload) => {
  received.panics.push(payload);
});
connection.on('CommandAcked', (payload) => {
  received.acks.push(payload);
});

const checks = [];
const check = (name, condition) => {
  checks.push({ name, ok: Boolean(condition) });
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}`);
};

// -- REST snapshot ---------------------------------------------------------
const devices = await json('/api/devices');
check('GET /api/devices returns the seeded fleet', devices.status === 200 && devices.body.items.length >= 5);

// -- realtime --------------------------------------------------------------
await connection.start();
await connection.invoke('JoinAll');
console.log('hub: connected + JoinAll');

await timeout(3500);
check('PositionReceived events flow on all-devices', received.positions > 0);

// -- commands --------------------------------------------------------------
const command = await post('/api/devices/VEH-001/commands', {
  command_type: 'SET_FREQUENCY',
  payload: { seconds: 30 },
});
check('POST command returns 201 Pending', command.status === 201 && command.body.status === 'Pending');

const history = await json('/api/devices/VEH-001/commands');
check('GET command history contains the dispatch', history.body.items.some((item) => item.command_id === command.body.command_id));

await timeout(2500);
check(
  'CommandAcked event received for the dispatch',
  received.acks.some((ack) => ack.command_id === command.body.command_id && ack.status === 'Acked'),
);

// -- panic -----------------------------------------------------------------
const panic = await post('/api/panic', {
  vehicle_id: 'VEH-002',
  timestamp_utc: new Date().toISOString(),
  last_known_position: { latitude: 41.15, longitude: -8.61 },
  source: 'MobileApp',
});
check('POST /api/panic returns 201', panic.status === 201 && typeof panic.body.panic_id === 'string');

await timeout(500);
check(
  'PanicReceived event received',
  received.panics.some((event) => event.panic_id === panic.body.panic_id),
);

const ack = await post(`/api/panic/${panic.body.panic_id}/ack`, { operator: 'smoke-test' });
check('POST panic ack marks it acknowledged', ack.status === 200 && ack.body.acknowledged === true);

const pending = await json('/api/panic?acknowledged=false&size=100');
check('Acknowledged panic is filtered out of the pending list', !pending.body.items.some((item) => item.panic_id === panic.body.panic_id));

// -- trackers --------------------------------------------------------------
const tracker = await post('/api/trackers', {
  type: 'Autotrac',
  name: 'Smoke test tracker',
  vehicle_id: 'VEH-999',
  polling_interval_seconds: 30,
  credentials: { fleet_id: 'F-1', api_key: 'secret' },
  enabled: true,
});
check('POST /api/trackers returns 201', tracker.status === 201 && tracker.body.type === 'Autotrac');

const trackerList = await json('/api/trackers');
check('Tracker appears in the list', trackerList.body.items.some((item) => item.tracker_id === tracker.body.tracker_id));

const deleted = await json(`/api/trackers/${tracker.body.tracker_id}`, { method: 'DELETE' });
check('DELETE /api/trackers/{id} returns 204', deleted.status === 204);

await connection.stop();

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed -> ${failed.length === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed.length === 0 ? 0 : 1);
