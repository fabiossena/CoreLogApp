/**
 * Jest stub for `@react-native-firebase/messaging` (moduleNameMapper target).
 */

interface StubMessage {
  data?: Record<string, string | number | boolean | undefined>;
}

const listeners: Array<(message: StubMessage) => void> = [];
let backgroundHandler: ((message: StubMessage) => Promise<void>) | null = null;

const messaging = {
  onMessage(handler: (message: StubMessage) => void): () => void {
    listeners.push(handler);
    return () => {
      const index = listeners.indexOf(handler);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    };
  },
  setBackgroundMessageHandler(handler: (message: StubMessage) => Promise<void>): void {
    backgroundHandler = handler;
  },
  /** Test helper: simulate a foreground message. */
  async __emit(message: StubMessage): Promise<void> {
    for (const listener of [...listeners]) {
      listener(message);
    }
    if (backgroundHandler) {
      await backgroundHandler(message);
    }
  },
  /** Test helper: reset state between tests. */
  __reset(): void {
    listeners.length = 0;
    backgroundHandler = null;
  },
};

export default function messagingFactory(): typeof messaging {
  return messaging;
}
