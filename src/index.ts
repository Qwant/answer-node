import { AnswerApiError, AnswerNetworkError } from './errors.js';
import { sseGenerator } from './sse.js';
import type {
  AnswerV2Event,
  AnswerV2Input,
  AnswerV2Result,
  StreamHandle,
} from './types.js';

export { AnswerApiError, AnswerNetworkError } from './errors.js';
export type {
  AnswerV2Citation,
  AnswerV2Event,
  AnswerV2Input,
  AnswerV2Result,
  AnswerV2Source,
  AnswerV2UsageEntry,
  StreamHandle,
} from './types.js';

// ─── Client ───────────────────────────────────────────────────────────────────

export class AnswerClient {
  private readonly baseURL: string;
  private readonly apiKey: string;

  /**
   * @param opts.apiKey   Bearer token sent in the `Authorization` header
   * @param opts.baseURL  Override the base URL (default: `'https://api.staan.ai/v2'`) — useful for local dev
   */
  constructor(opts: { apiKey: string; baseURL?: string }) {
    this.baseURL = (opts.baseURL ?? 'https://api.staan.ai/v2').replace(/\/$/, '');
    this.apiKey = opts.apiKey;
  }

  // ─── Non-stream ─────────────────────────────────────────────────────────────

  /**
   * Fetch a complete (non-streamed) answer.
   *
   * @throws {AnswerApiError}     on non-2xx HTTP response
   * @throws {AnswerNetworkError} on network failure
   * @throws {DOMException}       (AbortError) if `signal` is aborted
   */
  async create(
    input: AnswerV2Input,
    signal?: AbortSignal,
  ): Promise<AnswerV2Result> {
    let res: Response;

    try {
      res = await fetch(`${this.baseURL}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ ...input, stream: false }),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new AnswerNetworkError('Fetch failed', err);
    }

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => null);
      }
      throw new AnswerApiError(res.status, body);
    }

    return res.json() as Promise<AnswerV2Result>;
  }

  // ─── Stream ─────────────────────────────────────────────────────────────────

  /**
   * Start a streaming answer. Returns a `StreamHandle` that supports:
   * - `for await (const event of stream) { ... }`
   * - `stream.onEvent(handler)` — synchronous callback, returns unsubscribe fn
   * - `stream.cancel()` — aborts the underlying HTTP request
   *
   * If you break out of the `for await` loop, the HTTP request is cancelled
   * automatically via `iterator.return()`.
   *
   * @throws {AnswerApiError}     on non-2xx HTTP response (before first event)
   * @throws {AnswerNetworkError} on network failure during streaming
   * @throws {DOMException}       (AbortError) if `opts.signal` is aborted or
   *                              `cancel()` is called
   */
  stream(
    input: AnswerV2Input,
    opts: { signal?: AbortSignal } = {},
  ): StreamHandle {
    const ac = new AbortController();

    // Link user-supplied signal to our internal controller
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => ac.abort(opts.signal!.reason), {
        once: true,
      });
    }

    // ── Queue + notify pattern ──────────────────────────────────────────────
    // Events are pushed into a queue shared by onEvent() and for-await.
    // onEvent handlers are called synchronously on push.
    // The async iterator waits for items via a Promise that gets resolved on push.

    type QueueItem = { event: AnswerV2Event } | { done: true } | { error: unknown };

    const queue: QueueItem[] = [];
    const handlers = new Set<(event: AnswerV2Event) => void>();
    let notify: (() => void) | null = null;

    function push(item: QueueItem): void {
      queue.push(item);
      if ('event' in item) {
        for (const h of handlers) {
          try {
            h(item.event);
          } catch {
            // Swallow handler errors to avoid breaking the stream
          }
        }
      }
      notify?.();
    }

    function waitForItem(): Promise<void> {
      return new Promise((resolve) => {
        notify = () => {
          notify = null;
          resolve();
        };
      });
    }

    // ── Start fetch in background ───────────────────────────────────────────
    (async () => {
      let res: Response;

      try {
        res = await fetch(`${this.baseURL}/answer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({ ...input, stream: true }),
          signal: ac.signal,
        });
      } catch (err) {
        push({ error: err });
        return;
      }

      if (!res.ok) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = await res.text().catch(() => null);
        }
        push({ error: new AnswerApiError(res.status, body) });
        return;
      }

      if (!res.body) {
        push({ error: new AnswerNetworkError('Response body is null', null) });
        return;
      }

      try {
        for await (const event of sseGenerator(res.body)) {
          push({ event });
        }
        push({ done: true });
      } catch (err) {
        push({ error: err });
      }
    })();

    // ── Async iterator ──────────────────────────────────────────────────────

    const asyncIterator: AsyncIterator<AnswerV2Event> = {
      async next() {
        while (true) {
          if (queue.length > 0) {
            const item = queue.shift()!;
            if ('done' in item) return { done: true, value: undefined };
            if ('error' in item) throw item.error;
            return { done: false, value: item.event };
          }
          await waitForItem();
        }
      },
      async return() {
        ac.abort();
        return { done: true, value: undefined };
      },
    };

    // ── StreamHandle ────────────────────────────────────────────────────────

    const handle: StreamHandle = {
      [Symbol.asyncIterator]() {
        return asyncIterator;
      },
      onEvent(handler: (event: AnswerV2Event) => void): () => void {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      cancel() {
        ac.abort();
      },
    };

    return handle;
  }
}
