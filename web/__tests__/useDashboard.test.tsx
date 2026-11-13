/**
 * Unit tests for the dashboard viewmodel: device-list merging, status
 * derivation, panic-banner state and the acknowledge flow.
 *
 * `ICoreLogClient` and `ITrackingRealtime` are mocked — no network, no hub.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDashboard } from '../src/viewmodels/useDashboard';
import {
  asClient,
  createApiMock,
  createRealtimeMock,
  makePositionEvent,
} from './helpers/mocks';

describe('useDashboard', () => {
  it('loads devices and pending panics, and joins the all-devices group', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();

    const { result } = renderHook(() =>
      useDashboard(asClient(api), realtime.realtime, 'fabio.sena'),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.devices.map((device) => device.vehicle_id)).toEqual([
      'VEH-001',
      'VEH-002',
    ]);
    expect(result.current.activePanics).toHaveLength(1);
    expect(result.current.activePanics[0].panic_id).toBe('panic-1');
    expect(realtime.isJoinedAll()).toBe(true);
    expect(result.current.connectionState).toBe('Connected');
  });

  it('merges a live PositionReceived event into an existing device', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDashboard(asClient(api), realtime.realtime, 'fabio.sena'),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      realtime.emitPosition(
        makePositionEvent({
          vehicle_id: 'VEH-002',
          latitude: 40.7,
          longitude: -9.1,
          speed_kmh: 55.5,
        }),
      );
    });

    const merged = result.current.devices.find((device) => device.vehicle_id === 'VEH-002');
    expect(merged).toBeDefined();
    // Fresh position ⇒ derived status flips from PossiblyOffline to Online.
    expect(merged!.status).toBe('Online');
    expect(merged!.last_position!.latitude).toBe(40.7);
    expect(merged!.last_position!.speed_kmh).toBe(55.5);
    expect(merged!.source).toBe('MobileApp');
  });

  it('appends unknown vehicles when a position arrives for the first time', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDashboard(asClient(api), realtime.realtime, 'fabio.sena'),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      realtime.emitPosition(makePositionEvent({ vehicle_id: 'VEH-999' }));
    });

    const created = result.current.devices.find((device) => device.vehicle_id === 'VEH-999');
    expect(created).toBeDefined();
    expect(created!.display_name).toBe('VEH-999');
    expect(created!.status).toBe('Online');
    expect(result.current.devices).toHaveLength(3);
  });

  it('applies DeviceStatusChanged events to the matching device', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDashboard(asClient(api), realtime.realtime, 'fabio.sena'),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      realtime.emitStatusChanged({
        vehicle_id: 'VEH-001',
        status: 'PossiblyOffline',
        previous_status: 'Online',
        changed_at_utc: new Date().toISOString(),
        reason: 'No position received for 3 minutes',
      });
    });

    const device = result.current.devices.find((item) => item.vehicle_id === 'VEH-001');
    expect(device!.status).toBe('PossiblyOffline');
    // The other device is untouched.
    expect(result.current.devices[1].status).toBe('PossiblyOffline');
  });

  it('adds live PanicReceived events to the banner', async () => {
    const api = createApiMock();
    api.getPanics.mockResolvedValue([]);
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDashboard(asClient(api), realtime.realtime, 'fabio.sena'),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activePanics).toHaveLength(0);

    act(() => {
      realtime.emitPanic({
        panic_id: 'panic-live',
        event_id: 'event-live',
        vehicle_id: 'VEH-002',
        timestamp_utc: '2026-11-12T11:30:00Z',
        last_known_position: { latitude: 41.1579, longitude: -8.6291 },
        source: 'MobileApp',
      });
    });

    expect(result.current.activePanics.map((panic) => panic.panic_id)).toEqual(['panic-live']);
    expect(result.current.acknowledgedPanicIds.has('panic-live')).toBe(false);
  });

  it('keeps the banner visible after acknowledgement and hides it only on dismiss', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDashboard(asClient(api), realtime.realtime, 'fabio.sena'),
    );
    await waitFor(() => expect(result.current.activePanics).toHaveLength(1));

    await act(async () => {
      await result.current.acknowledgePanic('panic-1');
    });

    expect(api.acknowledgePanic).toHaveBeenCalledWith('panic-1', { operator: 'fabio.sena' });
    expect(result.current.acknowledgedPanicIds.has('panic-1')).toBe(true);
    // Acknowledged but not yet dismissed — the banner is now dismissible.
    expect(result.current.activePanics).toHaveLength(1);

    act(() => {
      result.current.hidePanic('panic-1');
    });

    expect(result.current.activePanics).toHaveLength(0);
  });

  it('surfaces acknowledge failures as an error and keeps the banner', async () => {
    const api = createApiMock();
    api.acknowledgePanic.mockRejectedValueOnce(new Error('ack endpoint unavailable'));
    const realtime = createRealtimeMock();
    const { result } = renderHook(() =>
      useDashboard(asClient(api), realtime.realtime, 'fabio.sena'),
    );
    await waitFor(() => expect(result.current.activePanics).toHaveLength(1));

    await act(async () => {
      await result.current.acknowledgePanic('panic-1');
    });

    expect(result.current.error).toBe('ack endpoint unavailable');
    expect(result.current.acknowledgedPanicIds.has('panic-1')).toBe(false);
    expect(result.current.activePanics).toHaveLength(1);
  });

  it('stops reacting to events after unmount', async () => {
    const api = createApiMock();
    const realtime = createRealtimeMock();
    const { result, unmount } = renderHook(() =>
      useDashboard(asClient(api), realtime.realtime, 'fabio.sena'),
    );
    await waitFor(() => expect(result.current.activePanics).toHaveLength(1));

    unmount();

    act(() => {
      realtime.emitPanic({
        panic_id: 'panic-after-unmount',
        event_id: 'event-after-unmount',
        vehicle_id: 'VEH-001',
        timestamp_utc: '2026-11-12T11:35:00Z',
        last_known_position: { latitude: 41.1579, longitude: -8.6291 },
        source: 'MobileApp',
      });
    });

    expect(result.current.activePanics.map((panic) => panic.panic_id)).not.toContain(
      'panic-after-unmount',
    );
  });
});
