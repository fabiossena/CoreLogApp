/**
 * Unit tests for the command-center viewmodel: tracker registration
 * validation, fleet filtering, bulk command dispatch with per-device
 * acknowledgement/timeout and command history loading.
 *
 * `ICoreLogClient` and `ITrackingRealtime` are mocked — no network, no hub.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCommandCenter } from '../src/viewmodels/useCommandCenter';
import { buildCommandRequest } from '../src/domain/entities/Command';
import {
  asClient,
  createApiMock,
  createRealtimeMock,
  makeCommand,
  makeTracker,
} from './helpers/mocks';

describe('useCommandCenter', () => {
  it('loads devices and trackers and joins the all-devices group', async () => {
    const api = createApiMock();
    api.listTrackers.mockResolvedValue([makeTracker()]);
    const realtime = createRealtimeMock();

    const { result } = renderHook(() => useCommandCenter(asClient(api), realtime.realtime));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.devices).toHaveLength(2);
    expect(result.current.trackers).toHaveLength(1);
    expect(realtime.isJoinedAll()).toBe(true);
  });

  it('rejects tracker registration when required credentials are missing', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() => useCommandCenter(asClient(api), realtime.realtime));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const outcome = await act(async () =>
      result.current.registerTracker({
        type: 'Sascar',
        name: 'Fleet A',
        vehicle_id: 'VEH-010',
        polling_interval_seconds: 30,
        credentials: { plate: '12-AB-34' }, // integration_user + password missing
        enabled: true,
      }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContain('Integration user');
    expect(outcome.errors).toContain('Password');
    expect(api.registerTracker).not.toHaveBeenCalled();
  });

  it('registers a valid tracker and refreshes the tracker list', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() => useCommandCenter(asClient(api), realtime.realtime));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const outcome = await act(async () =>
      result.current.registerTracker({
        type: 'Autotrac',
        name: 'Fleet B',
        vehicle_id: 'VEH-020',
        polling_interval_seconds: 30,
        credentials: { fleet_id: 'FL-9', api_key: 'k-123' },
        enabled: true,
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.tracker).toEqual({
      tracker_id: 'tracker-new',
      type: 'Autotrac',
      vehicle_id: 'VEH-020',
    });
    expect(api.registerTracker).toHaveBeenCalledTimes(1);
    // List refreshed after the mutation (cache invalidation is CoreLogClient's job).
    expect(api.listTrackers).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('filters the fleet by region, status and trip', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() => useCommandCenter(asClient(api), realtime.realtime));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.filteredDevices).toHaveLength(2);

    act(() => {
      result.current.setFilters({ region: 'Porto' });
    });
    expect(result.current.filteredDevices.map((device) => device.vehicle_id)).toEqual(['VEH-001']);

    act(() => {
      result.current.setFilters({ region: '', status: 'All', tripId: 'trip-unknown' });
    });
    expect(result.current.filteredDevices).toHaveLength(0);
  });

  it('dispatches a bulk command to the filtered devices and awaits each ack/timeout', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useCommandCenter(asClient(api), realtime.realtime, { ackTimeoutMs: 60 }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Restrict the fleet to VEH-001 only for a deterministic single target …
    act(() => {
      result.current.setFilters({ region: 'Porto' });
    });

    let pending: ReturnType<typeof result.current.sendBulkCommand> | undefined;
    await act(async () => {
      pending = result.current.sendBulkCommand(
        buildCommandRequest('SET_FREQUENCY', { seconds: 30 }),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(api.dispatchCommand).toHaveBeenCalledTimes(1));
    expect(api.dispatchCommand).toHaveBeenCalledWith('VEH-001', {
      command_type: 'SET_FREQUENCY',
      payload: { seconds: 30 },
    });
    // Pending state is shown while waiting for the ack.
    expect(result.current.bulkResults).toEqual([
      { device_id: 'VEH-001', status: 'Pending', error: null },
    ]);

    act(() => {
      realtime.emitCommandAcked({
        command_id: 'cmd-VEH-001',
        device_id: 'VEH-001',
        status: 'Acked',
        acknowledged_at_utc: '2026-11-12T11:21:04Z',
      });
    });

    let results: Awaited<typeof pending>;
    await act(async () => {
      results = await pending;
    });
    expect(results).toEqual([
      { device_id: 'VEH-001', status: 'Acked', error: null },
    ]);
    await waitFor(() => expect(result.current.bulkResults[0].status).toBe('Acked'));
  });

  it('marks unacknowledged devices of a bulk command as Failed after the timeout', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useCommandCenter(asClient(api), realtime.realtime, { ackTimeoutMs: 40 }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // All devices, no ack ever emitted ⇒ every device fails on timeout.
    let pending: ReturnType<typeof result.current.sendBulkCommand> | undefined;
    let results: Awaited<typeof pending>;
    await act(async () => {
      pending = result.current.sendBulkCommand(buildCommandRequest('REACTIVATE'));
      results = await pending;
    });
    expect(results).toHaveLength(2);
    expect(results!.every((entry) => entry.status === 'Failed')).toBe(true);
    expect(results!.every((entry) => entry.error !== null)).toBe(true);
    await waitFor(() =>
      expect(result.current.bulkResults.every((entry) => entry.status === 'Failed')).toBe(true),
    );
  });

  it('reports a dispatch error per device without aborting the batch', async () => {
    const api = createApiMock();
    api.dispatchCommand.mockImplementation(async (deviceId, request) => {
      if (deviceId === 'VEH-002') {
        throw new Error('device offline');
      }
      return makeCommand(deviceId, request);
    });
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useCommandCenter(asClient(api), realtime.realtime, { ackTimeoutMs: 40 }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let pending: ReturnType<typeof result.current.sendBulkCommand> | undefined;
    let results: Awaited<typeof pending>;
    await act(async () => {
      pending = result.current.sendBulkCommand(buildCommandRequest('REACTIVATE'));
      results = await pending;
    });

    const failed = results!.find((entry) => entry.device_id === 'VEH-002');
    expect(failed).toEqual({ device_id: 'VEH-002', status: 'Failed', error: 'device offline' });
  });

  it('refuses to dispatch when no device matches the filters', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() => useCommandCenter(asClient(api), realtime.realtime));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setFilters({ tripId: 'no-such-trip' });
    });

    let results: Awaited<ReturnType<typeof result.current.sendBulkCommand>> | undefined;
    await act(async () => {
      results = await result.current.sendBulkCommand(
        buildCommandRequest('REQUEST_IMMEDIATE_POSITION'),
      );
    });

    expect(results).toEqual([]);
    expect(api.dispatchCommand).not.toHaveBeenCalled();
    expect(result.current.error).toBe('No devices match the current filters.');
  });

  it('loads command history for a device', async () => {
    const api = createApiMock();
    api.getCommandHistory.mockResolvedValue([
      makeCommand('VEH-001', buildCommandRequest('SILENCE', { durationSeconds: 600 }), {
        status: 'Silenced',
        acknowledged_at_utc: '2026-11-12T11:21:04Z',
        silenced_until_utc: '2026-11-12T11:31:00Z',
      }),
    ]);
    const realtime = createRealtimeMock();
    const { result } = renderHook(() => useCommandCenter(asClient(api), realtime.realtime));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.loadHistory('VEH-001');
    });

    expect(result.current.historyDeviceId).toBe('VEH-001');
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].status).toBe('Silenced');
    expect(result.current.history[0].silenced_until_utc).toBe('2026-11-12T11:31:00Z');
  });
});
