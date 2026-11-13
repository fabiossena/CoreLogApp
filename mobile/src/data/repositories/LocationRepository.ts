/**
 * Location repository (data layer).
 *
 * Owns the **JS-side** offline buffer for positions: payloads that could not
 * be delivered are persisted by {@link PositionBuffer} (SQLite) and re-sent
 * on the next {@link LocationRepository.flush}. The native background service
 * owns the hot path (collection + batching); this repository serves the
 * JavaScript-originated sends (immediate-position fast path, drain-on-open).
 */
import {Position} from '../../domain/entities/Position';
import {
  PositionBatchSender,
  toTrackingEventDto,
  TrackingEventDto,
} from '../../infrastructure/http/CoreLogApiClient';
import {PositionBuffer, SqliteExecutor} from '../local/PositionBuffer';

/** Constructor options of {@link LocationRepository}. */
export interface LocationRepositoryOptions {
  /** Batch transport (implemented by `CoreLogApiClient`). */
  sender: PositionBatchSender;
  /** SQLite executor backing the offline buffer. */
  executor: SqliteExecutor;
  /** `BATCH_SIZE` — maximum rows per flush. */
  batchSize: number;
}

/**
 * Stores positions offline and ships them to `POST /api/tracking/events`.
 *
 * @remarks
 * At-least-once semantics: rows are removed **after** a successful `202`;
 * a failed flush keeps them for the next attempt (exponential backoff is
 * owned by the axios retry interceptor and by the caller's schedule).
 */
export class LocationRepository {
  private readonly sender: PositionBatchSender;
  private readonly buffer: PositionBuffer;
  private readonly batchSize: number;

  /**
   * @param options - transport, SQLite executor and batch size.
   */
  constructor(options: LocationRepositoryOptions) {
    this.sender = options.sender;
    this.buffer = new PositionBuffer({db: options.executor});
    this.batchSize = Math.max(1, options.batchSize);
  }

  /**
   * Appends one position to the offline buffer (serialized to snake_case).
   *
   * @param position - domain position to persist.
   */
  async enqueuePosition(position: Position): Promise<void> {
    const payload = JSON.stringify(toTrackingEventDto(position));
    await this.buffer.appendPosition(payload);
  }

  /**
   * Sends up to `BATCH_SIZE` buffered positions.
   *
   * @returns how many positions were accepted by the server.
   * @throws when the transport fails — buffered rows are kept for retry.
   */
  async flush(): Promise<number> {
    const entries = await this.buffer.takePositions(this.batchSize);
    if (entries.length === 0) {
      return 0;
    }

    const events: TrackingEventDto[] = [];
    const validIds: number[] = [];
    for (const entry of entries) {
      try {
        events.push(JSON.parse(entry.payloadJson) as TrackingEventDto);
        validIds.push(entry.id);
      } catch {
        // Poison row (corrupt JSON): drop it so it cannot block the queue.
        await this.buffer.removePositions([entry.id]);
      }
    }
    if (events.length === 0) {
      return 0;
    }

    await this.sender.sendPositionBatch(events);
    await this.buffer.removePositions(validIds);
    return events.length;
  }

  /**
   * @returns number of positions waiting in the JS-side offline buffer.
   */
  async getPendingCount(): Promise<number> {
    return this.buffer.countPositions();
  }
}
