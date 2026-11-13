/**
 * Home screen (presentation layer — MVVM View).
 *
 * Renders: tracking ON/OFF, last successful send time, offline buffer count,
 * the Start/Stop button and the always-visible panic button.
 *
 * The screen contains **no business logic**: it reads the observable
 * {@link HomeViewModel} state via `useSyncExternalStore` and forwards button
 * presses to the ViewModel's commands.
 */
import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {HomeViewModel} from '../viewmodels/HomeViewModel';
import {PanicButton} from '../components/PanicButton';

/** Properties of {@link HomeScreen}. */
export interface HomeScreenProps {
  /** The ViewModel this view is bound to (injected by `App`). */
  viewModel: HomeViewModel;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Never';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return `${parsed.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')} UTC`;
}

/**
 * Main screen of the CoreLog app.
 *
 * @param props - see {@link HomeScreenProps}.
 */
export function HomeScreen({viewModel}: HomeScreenProps): React.ReactElement {
  // Observable view state — re-renders only when the snapshot changes.
  const state = useSyncExternalStore(viewModel.subscribe, viewModel.getSnapshot, viewModel.getSnapshot);

  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void viewModel.initialize();
    return () => {
      viewModel.dispose();
    };
  }, [viewModel]);

  useEffect(() => {
    if (state.lastPanicAtUtc) {
      setNotice(
        state.lastPanicQueued
          ? `Panic queued for delivery (${formatTimestamp(state.lastPanicAtUtc)})`
          : `Panic sent (${formatTimestamp(state.lastPanicAtUtc)})`,
      );
    }
  }, [state.lastPanicAtUtc, state.lastPanicQueued]);

  const lastSendLabel = useMemo(
    () => formatTimestamp(state.lastSendAtUtc),
    [state.lastSendAtUtc],
  );
  const bufferLabel = useMemo(
    () => `${state.bufferCount + state.localBufferCount} position(s) waiting`,
    [state.bufferCount, state.localBufferCount],
  );
  const statusLabel = useMemo(
    () => (state.trackingEnabled ? 'Tracking: ON' : 'Tracking: OFF'),
    [state.trackingEnabled],
  );
  const startStopLabel = useMemo(
    () => (state.trackingEnabled ? 'Stop tracking' : 'Start tracking'),
    [state.trackingEnabled],
  );
  const panicBusy = useMemo(
    () => state.isBusy && state.lastPanicAtUtc === null,
    [state.isBusy, state.lastPanicAtUtc],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>CoreLog</Text>

      <View style={styles.card} testID="status-card">
        <Text style={[styles.status, state.trackingEnabled ? styles.statusOn : styles.statusOff]}>
          {statusLabel}
        </Text>
        <Text style={styles.row}>Last successful send: {lastSendLabel}</Text>
        <Text style={styles.row}>Offline buffer: {bufferLabel}</Text>
        <Text style={styles.row}>Sampling every {state.intervalSeconds}s</Text>
        {state.silencedUntilUtc ? (
          <Text style={styles.row}>Silenced until {formatTimestamp(state.silencedUntilUtc)}</Text>
        ) : null}
        {state.lastError ? <Text style={styles.error}>{state.lastError}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </View>

      <PanicButton
        onPanic={() => {
          void viewModel.sendPanic();
        }}
        disabled={state.isBusy}
        busy={panicBusy}
      />

      <Pressable
        accessibilityRole="button"
        testID="start-stop-button"
        disabled={state.isBusy}
        onPress={() => {
          void (state.trackingEnabled ? viewModel.stopTracking() : viewModel.startTracking());
        }}
        style={({pressed}) => [
          styles.startStop,
          state.isBusy && styles.startStopDisabled,
          pressed && !state.isBusy && styles.startStopPressed,
        ]}>
        <Text style={styles.startStopLabel}>{startStopLabel}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#212121',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    gap: 6,
    elevation: 2,
  },
  status: {
    fontSize: 22,
    fontWeight: '700',
  },
  statusOn: {
    color: '#2e7d32',
  },
  statusOff: {
    color: '#616161',
  },
  row: {
    fontSize: 15,
    color: '#424242',
  },
  error: {
    fontSize: 14,
    color: '#c62828',
    marginTop: 4,
  },
  notice: {
    fontSize: 14,
    color: '#1565c0',
    marginTop: 4,
  },
  startStop: {
    backgroundColor: '#1565c0',
    borderRadius: 12,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  startStopPressed: {
    backgroundColor: '#0d47a1',
  },
  startStopDisabled: {
    backgroundColor: '#9e9e9e',
  },
  startStopLabel: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default HomeScreen;
