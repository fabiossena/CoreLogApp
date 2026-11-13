/**
 * Unit tests for `HandleRemoteCommandUseCase` (mocked target/ack sender).
 */
import {
  HandleRemoteCommandUseCase,
  RemoteCommandTarget,
  CommandAckSender,
  CommandAck,
  ImmediatePositionReporter,
} from '../src/domain/usecases/HandleRemoteCommandUseCase';
import {RemoteCommand} from '../src/domain/entities/RemoteCommand';

function command(overrides: Partial<RemoteCommand> = {}): RemoteCommand {
  return {
    commandId: 'c1c2c3c4-1111-4222-8333-444455556666',
    deviceId: 'VEH-001',
    commandType: 'SET_FREQUENCY',
    seconds: 30,
    ...overrides,
  };
}

interface Harness {
  useCase: HandleRemoteCommandUseCase;
  applied: RemoteCommand[];
  acks: Array<{deviceId: string; commandId: string; ack: CommandAck}>;
  ackError: Error | null;
  targetError: Error | null;
  errors: Array<{error: unknown; command: RemoteCommand}>;
}

function createHarness(
  options: {reporter?: ImmediatePositionReporter} = {},
): Harness {
  const applied: RemoteCommand[] = [];
  const acks: Array<{deviceId: string; commandId: string; ack: CommandAck}> = [];
  const errors: Array<{error: unknown; command: RemoteCommand}> = [];
  const state = {
    ackError: null as Error | null,
    targetError: null as Error | null,
  };

  const target: RemoteCommandTarget = {
    applyRemoteCommand: async cmd => {
      if (state.targetError) {
        throw state.targetError;
      }
      applied.push(cmd);
    },
  };
  const ackSender: CommandAckSender = {
    sendCommandAck: async (deviceId, commandId, ack) => {
      if (state.ackError) {
        throw state.ackError;
      }
      acks.push({deviceId, commandId, ack});
    },
  };

  const harness: Harness = {
    applied,
    acks,
    errors,
    get ackError() {
      return state.ackError;
    },
    set ackError(value: Error | null) {
      state.ackError = value;
    },
    get targetError() {
      return state.targetError;
    },
    set targetError(value: Error | null) {
      state.targetError = value;
    },
    useCase: new HandleRemoteCommandUseCase(target, ackSender, {
      immediatePositionReporter: options.reporter,
      onError: (error, cmd) => {
        errors.push({error, command: cmd});
      },
    }),
  };
  return harness;
}

describe('HandleRemoteCommandUseCase', () => {
  test('applies SET_FREQUENCY and acks Ok/Applied', async () => {
    const harness = createHarness();

    const result = await harness.useCase.execute(command());

    expect(result).toEqual({applied: true, acked: true});
    expect(harness.applied).toHaveLength(1);
    expect(harness.applied[0].commandType).toBe('SET_FREQUENCY');
    expect(harness.applied[0].seconds).toBe(30);
    expect(harness.acks).toEqual([
      {
        deviceId: 'VEH-001',
        commandId: 'c1c2c3c4-1111-4222-8333-444455556666',
        ack: {result: 'Ok', message: 'Applied'},
      },
    ]);
  });

  test('acks Failed with the error reason when applying throws', async () => {
    const harness = createHarness();
    harness.targetError = new Error('native module unavailable');

    const result = await harness.useCase.execute(
      command({commandType: 'SILENCE', seconds: undefined, durationSeconds: 600}),
    );

    expect(result).toEqual({applied: false, acked: true});
    expect(harness.acks[0].ack).toEqual({
      result: 'Failed',
      message: 'native module unavailable',
    });
    expect(harness.errors).toHaveLength(1);
  });

  test('never throws when the ack itself fails', async () => {
    const harness = createHarness();
    harness.ackError = new Error('ack endpoint unreachable');

    const result = await harness.useCase.execute(command());

    expect(result).toEqual({applied: true, acked: false});
    expect(harness.errors).toHaveLength(1);
  });

  test('REQUEST_IMMEDIATE_POSITION uses the JS fast path when it delivers', async () => {
    const reporter: ImmediatePositionReporter = {
      reportIfAvailable: async () => true,
    };
    const harness = createHarness({reporter});

    const result = await harness.useCase.execute(
      command({commandType: 'REQUEST_IMMEDIATE_POSITION', seconds: undefined}),
    );

    expect(result).toEqual({applied: true, acked: true});
    expect(harness.applied).toHaveLength(0); // native target not needed
    expect(harness.acks[0].ack).toEqual({result: 'Ok', message: 'Applied'});
  });

  test('REQUEST_IMMEDIATE_POSITION falls back to the native target when no position exists', async () => {
    const reporter: ImmediatePositionReporter = {
      reportIfAvailable: async () => false,
    };
    const harness = createHarness({reporter});

    const result = await harness.useCase.execute(
      command({commandType: 'REQUEST_IMMEDIATE_POSITION', seconds: undefined}),
    );

    expect(result).toEqual({applied: true, acked: true});
    expect(harness.applied).toHaveLength(1);
    expect(harness.applied[0].commandType).toBe('REQUEST_IMMEDIATE_POSITION');
  });

  test('REACTIVATE is forwarded to the background service', async () => {
    const harness = createHarness();

    await harness.useCase.execute(
      command({commandType: 'REACTIVATE', seconds: undefined}),
    );

    expect(harness.applied[0].commandType).toBe('REACTIVATE');
    expect(harness.acks[0].ack).toEqual({result: 'Ok', message: 'Applied'});
  });
});
