/**
 * Command repository (data layer).
 *
 * Exposes remote-command acknowledgement as a repository operation, adapting
 * the {@link CommandAckTransport} port (implemented by `CoreLogApiClient`)
 * to the {@link CommandAckSender} port consumed by `HandleRemoteCommandUseCase`.
 */
import {
  CommandAck,
  CommandAckSender,
} from '../../domain/usecases/HandleRemoteCommandUseCase';
import {CommandAckTransport} from '../../infrastructure/http/CoreLogApiClient';

/**
 * Delivers command acknowledgements to CoreLog
 * (`POST /api/devices/{deviceId}/commands/{commandId}/ack`, contract §3).
 */
export class CommandRepository implements CommandAckSender {
  private readonly transport: CommandAckTransport;

  /**
   * @param transport - HTTP transport (implemented by `CoreLogApiClient`).
   */
  constructor(transport: CommandAckTransport) {
    this.transport = transport;
  }

  /**
   * Acknowledges one remote command.
   *
   * @param deviceId - `device_id` path segment.
   * @param commandId - `command_id` path segment.
   * @param ack - `{ result, message }` body.
   * @throws when the ack could not be delivered.
   */
  async sendCommandAck(deviceId: string, commandId: string, ack: CommandAck): Promise<void> {
    await this.transport.sendCommandAck(deviceId, commandId, ack);
  }
}
