/**
 * Unit tests for pure domain helpers: status derivation, list merging,
 * command request building, the `CommandAckTracker` acknowledgement lifecycle
 * and tracker credential validation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPositionEvent,
  applyStatusChanged,
  deriveDeviceStatus,
  OFFLINE_AFTER_MS,
  POSSIBLY_OFFLINE_AFTER_MS,
  type Device,
} from '../src/domain/entities/Device';
import {
  buildCommandRequest,
  CommandAckTracker,
} from '../src/domain/entities/Command';
import {
  mergePanicReceived,
  panicFromPayload,
} from '../src/domain/entities/PanicEvent';
import {
  TRACKER_CREDENTIAL_FIELDS,
  validateTrackerCredentials,
} from '../src/domain/entities/Tracker';
import { makeDevice, makePositionEvent } from './helpers/mocks';

describe('deriveDeviceStatus', () => {
  const now = Date.parse('2026-11-12T11:21:00Z');

  it('reports Online for a fresh position', () => {
    expect(deriveDeviceStatus('2026-11-12T11:20:00Z', now)).toBe('Online');
  });

  it('reports PossiblyOffline between the 3 and 30 minute thresholds', () => {
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    expect(deriveDeviceStatus(new Date(fiveMinutesAgo).toISOString(), now)).toBe(
      'PossiblyOffline',
    );
    expect(POSSIBLY_OFFLINE_AFTER_MS).toBe(3 * 60 * 1000);
    expect(OFFLINE_AFTER_MS).toBe(30 * 60 * 1000);
  });

  it('reports Offline for stale or missing timestamps', () => {
    const oneHourAgo = now - 60 * 60 * 1000;
    expect(deriveDeviceStatus(new Date(oneHourAgo).toISOString(), now)).toBe('Offline');
    expect(deriveDeviceStatus(null, now)).toBe('Offline');
    expect(deriveDeviceStatus('not-a-date', now)).toBe('Offline');
  });
});

describe('applyPositionEvent', () => {
  it('refreshes an existing device and derives an Online status', () => {
    const staleDevice = makeDevice({
      vehicle_id: 'VEH-002',
      status: 'PossiblyOffline',
      last_position: null,
      last_position_at_utc: null,
    });
    const event = makePositionEvent({ vehicle_id: 'VEH-002', latitude: 39.5 });

    const next = applyPositionEvent([staleDevice], event);

    expect(next).toHaveLength(1);
    expect(next[0].last_position?.latitude).toBe(39.5);
    expect(next[0].last_position_at_utc).toBe(event.timestamp_utc);
    expect(next[0].status).toBe('Online');
    expect(next[0].trip_id).toBe('trip-1');
  });

  it('appends a minimal record for an unknown vehicle', () => {
    const event = makePositionEvent({ vehicle_id: 'VEH-404' });
    const next = applyPositionEvent([], event);

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      vehicle_id: 'VEH-404',
      display_name: 'VEH-404',
      status: 'Online',
      region: null,
    });
  });

  it('does not mutate the input array', () => {
    const devices: Device[] = [makeDevice()];
    const snapshot = [...devices];
    applyPositionEvent(devices, makePositionEvent({ latitude: 1, longitude: 2 }));
    expect(devices).toEqual(snapshot);
  });
});

describe('applyStatusChanged', () => {
  it('updates only the matching device', () => {
    const devices = [makeDevice(), makeDevice({ vehicle_id: 'VEH-002' })];
    const next = applyStatusChanged(devices, {
      vehicle_id: 'VEH-002',
      status: 'Offline',
      previous_status: 'Online',
      changed_at_utc: '2026-11-12T11:25:00Z',
      reason: 'No position received for 30 minutes',
    });

    expect(next[0].status).toBe('Online');
    expect(next[1].status).toBe('Offline');
  });
});

describe('panic helpers', () => {
  it('converts a live payload into a pending panic record', () => {
    const panic = panicFromPayload({
      panic_id: 'p-live',
      event_id: 'e-live',
      vehicle_id: 'VEH-001',
      timestamp_utc: '2026-11-12T11:20:00Z',
      last_known_position: { latitude: 41.1579, longitude: -8.6291 },
      source: 'MobileApp',
    });

    expect(panic).toMatchObject({
      panic_id: 'p-live',
      acknowledged: false,
      acknowledged_at_utc: null,
      acknowledged_by: null,
      last_known_position: { latitude: 41.1579, longitude: -8.6291 },
    });
  });

  it('ignores duplicate live panics', () => {
    const payload = {
      panic_id: 'p-live',
      event_id: 'e-live',
      vehicle_id: 'VEH-001',
      timestamp_utc: '2026-11-12T11:20:00Z',
      last_known_position: { latitude: 41.1579, longitude: -8.6291 },
      source: 'MobileApp',
    };
    const once = mergePanicReceived([], payload);
    const twice = mergePanicReceived(once, payload);

    expect(twice).toHaveLength(1);
    expect(twice).toBe(once);
  });
});

describe('buildCommandRequest', () => {
  it('builds payload-less commands', () => {
    expect(buildCommandRequest('REACTIVATE')).toEqual({
      command_type: 'REACTIVATE',
      payload: {},
    });
    expect(buildCommandRequest('REQUEST_IMMEDIATE_POSITION')).toEqual({
      command_type: 'REQUEST_IMMEDIATE_POSITION',
      payload: {},
    });
  });

  it('builds SET_FREQUENCY and SILENCE with their payloads', () => {
    expect(buildCommandRequest('SET_FREQUENCY', { seconds: 30 })).toEqual({
      command_type: 'SET_FREQUENCY',
      payload: { seconds: 30 },
    });
    expect(buildCommandRequest('SILENCE', { durationSeconds: 600 })).toEqual({
      command_type: 'SILENCE',
      payload: { duration_seconds: 600 },
    });
  });

  it('rejects invalid payloads with an English message', () => {
    expect(() => buildCommandRequest('SET_FREQUENCY')).toThrow(/positive "seconds"/);
    expect(() => buildCommandRequest('SET_FREQUENCY', { seconds: 0 })).toThrow(
      /positive "seconds"/,
    );
    expect(() => buildCommandRequest('SILENCE', { durationSeconds: -5 })).toThrow(
      /positive "durationSeconds"/,
    );
  });
});

describe('CommandAckTracker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a tracked command when the matching ack arrives', async () => {
    const tracker = new CommandAckTracker(1_000);
    const pending = tracker.track('cmd-1');
    const resolved = tracker.handleAck({
      command_id: 'cmd-1',
      device_id: 'VEH-001',
      status: 'Acked',
      acknowledged_at_utc: '2026-11-12T11:21:04Z',
    });

    expect(resolved).toBe(true);
    await expect(pending).resolves.toEqual({
      command_id: 'cmd-1',
      status: 'Acked',
      acknowledged_at_utc: '2026-11-12T11:21:04Z',
      error: null,
    });
  });

  it('buffers an ack that arrives before the waiter is registered', async () => {
    const tracker = new CommandAckTracker(1_000);
    expect(
      tracker.handleAck({
        command_id: 'cmd-early',
        device_id: 'VEH-001',
        status: 'Acked',
        acknowledged_at_utc: '2026-11-12T11:21:04Z',
      }),
    ).toBe(false);

    await expect(tracker.track('cmd-early')).resolves.toMatchObject({ status: 'Acked' });
  });

  it('fails a tracked command when the timeout expires', async () => {
    vi.useFakeTimers();
    const tracker = new CommandAckTracker(500);
    const pending = tracker.track('cmd-timeout');

    vi.advanceTimersByTime(501);

    await expect(pending).resolves.toEqual({
      command_id: 'cmd-timeout',
      status: 'Failed',
      acknowledged_at_utc: null,
      error: 'No acknowledgement received within 500 ms.',
    });
  });

  it('clear() fails every pending waiter (unmount safety)', async () => {
    const tracker = new CommandAckTracker(10_000);
    const pending = tracker.track('cmd-cancel');
    tracker.clear();

    const outcome = await pending;
    expect(outcome.status).toBe('Failed');
    expect(outcome.error).toContain('cancelled');
  });

  it('reports a non-Acked terminal status as Failed', async () => {
    const tracker = new CommandAckTracker(1_000);
    const pending = tracker.track('cmd-failed');
    tracker.handleAck({
      command_id: 'cmd-failed',
      device_id: 'VEH-001',
      status: 'Failed',
      acknowledged_at_utc: '2026-11-12T11:21:04Z',
    });

    await expect(pending).resolves.toMatchObject({
      status: 'Failed',
      error: 'Command finished with status "Failed".',
    });
  });
});

describe('tracker credential validation', () => {
  it('exposes credential metadata for every tracker type', () => {
    expect(Object.keys(TRACKER_CREDENTIAL_FIELDS).sort()).toEqual([
      'Autotrac',
      'ChineseGPS',
      'MobileApp',
      'Omnilink',
      'Sascar',
    ]);
    // MobileApp has a single optional credential.
    expect(
      TRACKER_CREDENTIAL_FIELDS.MobileApp.every((field) => field.required === false),
    ).toBe(true);
  });

  it('reports missing required credentials by label', () => {
    expect(validateTrackerCredentials('Omnilink', {})).toEqual([
      'External fleet id',
      'WSTT user',
      'WSTT password',
    ]);
    expect(
      validateTrackerCredentials('ChineseGPS', {
        traccar_device_id: 'TRC-118',
        chip_model: 'Concox GT06',
      }),
    ).toEqual([]);
    expect(validateTrackerCredentials('MobileApp', {})).toEqual([]);
  });
});
