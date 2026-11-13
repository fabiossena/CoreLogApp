/**
 * Remote command domain entity.
 *
 * Represents an FCM **data message** dispatched by CoreLog
 * (`docs/api-contract.md`, section 8). Data keys arrive in snake_case and are
 * normalized into this camelCase-free, typed representation:
 *
 * | `command_type`               | extra data keys   |
 * |------------------------------|-------------------|
 * | `SET_FREQUENCY`              | `seconds`         |
 * | `SILENCE`                    | `duration_seconds`|
 * | `REACTIVATE`                 | —                 |
 * | `REQUEST_IMMEDIATE_POSITION` | —                 |
 *
 * Every message also carries `command_id` and `device_id`.
 */

/** The four command types CoreLog can send to a mobile device. */
export type RemoteCommandType =
  | 'SET_FREQUENCY'
  | 'SILENCE'
  | 'REACTIVATE'
  | 'REQUEST_IMMEDIATE_POSITION';

/** All known command types, useful for exhaustive runtime checks. */
export const REMOTE_COMMAND_TYPES: readonly RemoteCommandType[] = [
  'SET_FREQUENCY',
  'SILENCE',
  'REACTIVATE',
  'REQUEST_IMMEDIATE_POSITION',
];

/** A parsed remote command. */
export interface RemoteCommand {
  /** Correlation id used for the ack (`command_id` on the wire). */
  commandId: string;
  /** Target device/vehicle (`device_id` on the wire). */
  deviceId: string;
  /** Command discriminator (`command_type` on the wire). */
  commandType: RemoteCommandType;
  /** New sampling period, present only for `SET_FREQUENCY`. */
  seconds?: number;
  /** Silence duration, present only for `SILENCE`. */
  durationSeconds?: number;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Parses an FCM data payload into a {@link RemoteCommand}.
 *
 * @param data - raw FCM data message (`string | number | boolean` values).
 * @returns the parsed command, or `null` when the payload is not a valid
 *          CoreLog command (missing `command_id`, `device_id`, unknown type,
 *          or `SET_FREQUENCY`/`SILENCE` without a usable duration).
 */
export function parseRemoteCommand(
  data: Record<string, string | number | boolean | undefined>,
): RemoteCommand | null {
  const commandId = data.command_id;
  const deviceId = data.device_id;
  const commandType = data.command_type;
  if (
    typeof commandId !== 'string' ||
    commandId === '' ||
    typeof deviceId !== 'string' ||
    deviceId === '' ||
    typeof commandType !== 'string'
  ) {
    return null;
  }
  if (!(REMOTE_COMMAND_TYPES as readonly string[]).includes(commandType)) {
    return null;
  }

  const base = {commandId, deviceId, commandType: commandType as RemoteCommandType};

  switch (base.commandType) {
    case 'SET_FREQUENCY': {
      const seconds = readOptionalPositiveInt(data.seconds);
      return seconds === undefined ? null : {...base, seconds};
    }
    case 'SILENCE': {
      const durationSeconds = readOptionalPositiveInt(data.duration_seconds);
      return durationSeconds === undefined ? null : {...base, durationSeconds};
    }
    default:
      return base;
  }
}
