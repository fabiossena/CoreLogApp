/**
 * Unit tests for the device-detail viewmodel: group join, trail updates and
 * the command dispatch lifecycle (`CommandAcked` handling + timeout).
 *
 * `ICoreLogClient` and `ITrackingRealtime` are mocked — no network, no hub.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDeviceDetail } from '../src/viewmodels/useDeviceDetail';
import { buildCommandRequest, type Command } from '../src/domain/entities/Command';
import {
  asClient,
  createApiMock,
  createRealtimeMock,
  makePositionEvent,
} from './helpers/mocks';

describe('useDeviceDetail', () => {
  it('loads the device, its last position and joins the device group', async () => {
    const api = createApiMock();
    api.getLastPosition.mockResolvedValue(makePositionEvent());
    api.getPositions.mockResolvedValue([
      makePositionEvent({ event_id: 'e-trail-1' }),
      makePositionEvent({ event_id: 'e-trail-2' }),
    ]);
    const realtime = createRealtimeMock();

    const { result } = renderHook(() =>
      useDeviceDetail(asClient(api), realtime.realtime, 'VEH-001'),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(realtime.joinedVehicles()).toContain('VEH-001');
    expect(result.current.device?.display_name).toBe('Van 01');
    expect(result.current.currentPosition?.vehicle_id).toBe('VEH-001');
    expect(result.current.trail).toHaveLength(2);
    // 24h window requested with ISO-8601 UTC bounds.
    const [vehicleId, fromUtc, toUtc] = api.getPositions.mock.calls[0];
    expect(vehicleId).toBe('VEH-001');
    expect(Number.isNaN(Date.parse(fromUtc))).toBe(false);
    expect(Number.isNaN(Date.parse(toUtc))).toBe(false);
    expect(Date.parse(toUtc) - Date.parse(fromUtc)).toBe(24 * 60 * 60 * 1000);
  });

  it('only appends live positions belonging to this vehicle', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDeviceDetail(asClient(api), realtime.realtime, 'VEH-001'),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      realtime.emitPosition(makePositionEvent({ vehicle_id: 'VEH-002', event_id: 'foreign' }));
    });
    expect(result.current.trail).toHaveLength(0);

    act(() => {
      realtime.emitPosition(makePositionEvent({ event_id: 'own-1' }));
      realtime.emitPosition(makePositionEvent({ event_id: 'own-1' })); // duplicate ignored
      realtime.emitPosition(makePositionEvent({ event_id: 'own-2' }));
    });

    expect(result.current.trail.map((position) => position.event_id)).toEqual([
      'own-1',
      'own-2',
    ]);
    expect(result.current.currentPosition?.event_id).toBe('own-2');
  });

  it('marks a command as Acked when CommandAcked arrives', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDeviceDetail(asClient(api), realtime.realtime, 'VEH-001', { ackTimeoutMs: 5_000 }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let pending: ReturnType<typeof result.current.sendCommand> | undefined;
    await act(async () => {
      pending = result.current.sendCommand(buildCommandRequest('REQUEST_IMMEDIATE_POSITION'));
      await Promise.resolve();
    });
    await waitFor(() => expect(api.dispatchCommand).toHaveBeenCalledTimes(1));
    expect(api.dispatchCommand).toHaveBeenCalledWith('VEH-001', {
      command_type: 'REQUEST_IMMEDIATE_POSITION',
      payload: {},
    });

    act(() => {
      realtime.emitCommandAcked({
        command_id: 'cmd-VEH-001',
        device_id: 'VEH-001',
        status: 'Acked',
        acknowledged_at_utc: '2026-11-12T11:21:04Z',
      });
    });

    let command: Command | null | undefined;
    await act(async () => {
      command = await pending;
    });
    expect(command?.status).toBe('Acked');
    expect(command?.acknowledged_at_utc).toBe('2026-11-12T11:21:04Z');
    await waitFor(() => expect(result.current.sentCommands[0].status).toBe('Acked'));
    expect(result.current.error).toBeNull();
  });

  it('marks a command as Failed when no acknowledgement arrives in time', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDeviceDetail(asClient(api), realtime.realtime, 'VEH-001', { ackTimeoutMs: 40 }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let pending: ReturnType<typeof result.current.sendCommand> | undefined;
    let command: Command | null | undefined;
    await act(async () => {
      pending = result.current.sendCommand(
        buildCommandRequest('SET_FREQUENCY', { seconds: 30 }),
      );
      command = await pending;
    });

    expect(command?.status).toBe('Failed');
    expect(command?.error).toContain('No acknowledgement received');
    await waitFor(() => expect(result.current.sentCommands[0].status).toBe('Failed'));
  });

  it('reports dispatch errors without adding a command', async () => {
    const api = createApiMock();
    api.dispatchCommand.mockRejectedValueOnce(new Error('device unreachable'));
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDeviceDetail(asClient(api), realtime.realtime, 'VEH-001'),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let pending: ReturnType<typeof result.current.sendCommand> | undefined;
    let command: Command | null | undefined;
    await act(async () => {
      pending = result.current.sendCommand(buildCommandRequest('REACTIVATE'));
      command = await pending;
    });

    expect(command).toBeNull();
    expect(result.current.error).toBe('device unreachable');
    expect(result.current.sentCommands).toHaveLength(0);
    expect(result.current.isSendingCommand).toBe(false);
  });

  it('does nothing when the vehicle id is empty', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDeviceDetail(asClient(api), realtime.realtime, ''),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.getPositions).not.toHaveBeenCalled();
    expect(realtime.joinedVehicles()).toHaveLength(0);
    expect(result.current.device).toBeNull();
  });
});
