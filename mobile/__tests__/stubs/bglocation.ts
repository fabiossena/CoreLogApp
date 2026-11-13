/**
 * Jest stub for `@bglocation/react-native` (moduleNameMapper target).
 *
 * The real library is a TurboModule requiring a device; tests only need the
 * permission API surface used by `BackgroundServiceBridge`.
 */

const permissionState = {granted: true, background: true};

const bglocation = {
  async checkPermissions(): Promise<{granted: boolean; background: boolean}> {
    return {...permissionState};
  },
  async requestPermissions(_options: {permissions: string[]}): Promise<{
    granted: boolean;
    background: boolean;
  }> {
    return {...permissionState};
  },
  /** Test helper: force the next permission result. */
  __setPermissions(granted: boolean, background: boolean): void {
    permissionState.granted = granted;
    permissionState.background = background;
  },
};

export function checkPermissions(): Promise<{granted: boolean; background: boolean}> {
  return bglocation.checkPermissions();
}

export function requestPermissions(options: {permissions: string[]}): Promise<{
  granted: boolean;
  background: boolean;
}> {
  return bglocation.requestPermissions(options);
}

export default bglocation;
