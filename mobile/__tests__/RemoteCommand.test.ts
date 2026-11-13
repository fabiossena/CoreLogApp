/**
 * Unit tests for the FCM payload parser (`parseRemoteCommand`).
 */
import {parseRemoteCommand} from '../src/domain/entities/RemoteCommand';

describe('parseRemoteCommand', () => {
  test('parses SET_FREQUENCY with numeric seconds', () => {
    const command = parseRemoteCommand({
      command_id: 'c1c2c3c4-1111-4222-8333-444455556666',
      device_id: 'VEH-001',
      command_type: 'SET_FREQUENCY',
      seconds: 30,
    });

    expect(command).toEqual({
      commandId: 'c1c2c3c4-1111-4222-8333-444455556666',
      deviceId: 'VEH-001',
      commandType: 'SET_FREQUENCY',
      seconds: 30,
    });
  });

  test('parses SET_FREQUENCY with string seconds (FCM data values are strings)', () => {
    const command = parseRemoteCommand({
      command_id: 'cmd-1',
      device_id: 'VEH-001',
      command_type: 'SET_FREQUENCY',
      seconds: '15',
    });

    expect(command?.seconds).toBe(15);
  });

  test('parses SILENCE with duration_seconds', () => {
    const command = parseRemoteCommand({
      command_id: 'cmd-2',
      device_id: 'VEH-001',
      command_type: 'SILENCE',
      duration_seconds: 600,
    });

    expect(command).toEqual({
      commandId: 'cmd-2',
      deviceId: 'VEH-001',
      commandType: 'SILENCE',
      durationSeconds: 600,
    });
  });

  test('parses REACTIVATE and REQUEST_IMMEDIATE_POSITION without payload keys', () => {
    expect(
      parseRemoteCommand({
        command_id: 'cmd-3',
        device_id: 'VEH-001',
        command_type: 'REACTIVATE',
      }),
    ).toEqual({
      commandId: 'cmd-3',
      deviceId: 'VEH-001',
      commandType: 'REACTIVATE',
    });

    expect(
      parseRemoteCommand({
        command_id: 'cmd-4',
        device_id: 'VEH-001',
        command_type: 'REQUEST_IMMEDIATE_POSITION',
      })?.commandType,
    ).toBe('REQUEST_IMMEDIATE_POSITION');
  });

  test('rejects unknown command types', () => {
    expect(
      parseRemoteCommand({
        command_id: 'cmd-5',
        device_id: 'VEH-001',
        command_type: 'SELF_DESTRUCT',
      }),
    ).toBeNull();
  });

  test('rejects payloads missing command_id or device_id', () => {
    expect(parseRemoteCommand({device_id: 'VEH-001', command_type: 'REACTIVATE'})).toBeNull();
    expect(parseRemoteCommand({command_id: 'cmd', command_type: 'REACTIVATE'})).toBeNull();
    expect(parseRemoteCommand({})).toBeNull();
  });

  test('rejects SET_FREQUENCY without a usable seconds value', () => {
    expect(
      parseRemoteCommand({
        command_id: 'cmd-6',
        device_id: 'VEH-001',
        command_type: 'SET_FREQUENCY',
      }),
    ).toBeNull();
    expect(
      parseRemoteCommand({
        command_id: 'cmd-7',
        device_id: 'VEH-001',
        command_type: 'SET_FREQUENCY',
        seconds: -5,
      }),
    ).toBeNull();
  });
});
