/**
 * Panic button component (presentation layer).
 *
 * Pure view: it renders a large, always-visible button and forwards presses
 * to the ViewModel through `onPanic`. No business logic lives here.
 */
import React, {useMemo} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';

/** Properties of {@link PanicButton}. */
export interface PanicButtonProps {
  /** Invoked when the user presses the button (ViewModel command). */
  onPanic: () => void;
  /** Disables the button (e.g. while another command is running). */
  disabled?: boolean;
  /** Shows the in-progress indicator while the panic is being sent. */
  busy?: boolean;
}

/**
 * Large red panic button, always visible on the home screen.
 *
 * @param props - see {@link PanicButtonProps}.
 */
export function PanicButton({onPanic, disabled = false, busy = false}: PanicButtonProps): React.ReactElement {
  const label = useMemo(() => (busy ? 'SENDING…' : 'PANIC'), [busy]);
  const isDisabled = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Raise panic"
      testID="panic-button"
      disabled={isDisabled}
      onPress={onPanic}
      style={({pressed}) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}>
      <View style={styles.content}>
        {busy ? <ActivityIndicator color="#ffffff" style={styles.spinner} /> : null}
        <Text style={styles.label}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#c62828',
    borderRadius: 16,
    minHeight: 96,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 4},
  },
  buttonPressed: {
    backgroundColor: '#8e0000',
  },
  buttonDisabled: {
    backgroundColor: '#9e9e9e',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinner: {
    marginRight: 12,
  },
  label: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
  },
});

export default PanicButton;
