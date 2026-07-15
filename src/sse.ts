import type { AnswerV2Event, AnswerV2Source } from './types.js';
import { AnswerNetworkError } from './errors.js';

// ─── SSE block parser ─────────────────────────────────────────────────────────

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let eventName = '';
  let dataLine = '';

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLine += line.slice(5).trim();
    }
  }

  if (!eventName || !dataLine) return null;

  try {
    return { event: eventName, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

// ─── Event mapper ─────────────────────────────────────────────────────────────

export function mapSseEvent(name: string, data: unknown): AnswerV2Event | null {
  switch (name) {
    case 'sources':
      return { type: 'sources', sources: data as AnswerV2Source[] };
    case 'assistant':
      // data is a raw string, not an object
      return { type: 'assistant', delta: data as string };
    case 'citation':
      return {
        type: 'citation',
        reference_ids: (data as { reference_ids: number[] }).reference_ids,
      };
    case 'related':
      return {
        type: 'related',
        related_queries: (data as { related_queries: string[] }).related_queries,
      };
    case 'done':
      return {
        type: 'done',
        finish_reason: (data as { finish_reason: string }).finish_reason,
      };
    default:
      return null;
  }
}

// ─── Async SSE generator ──────────────────────────────────────────────────────

/**
 * Reads an SSE response body and yields parsed AnswerV2Events.
 * Handles partial chunks by buffering across read() calls.
 * Always releases the reader lock in the finally block.
 */
export async function* sseGenerator(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AnswerV2Event> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      let done: boolean;
      let value: Uint8Array | undefined;

      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        // Re-throw AbortError as-is; wrap everything else
        if (err instanceof Error && err.name === 'AbortError') throw err;
        throw new AnswerNetworkError('Stream read failed', err);
      }

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE blocks are separated by double newlines
      const blocks = buffer.split('\n\n');
      // Keep the last (potentially incomplete) block in the buffer
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;

        const parsed = parseSseBlock(trimmed);
        if (!parsed) continue;

        const event = mapSseEvent(parsed.event, parsed.data);
        if (event) yield event;
      }
    }

    // Flush any remaining buffer content
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer.trim());
      if (parsed) {
        const event = mapSseEvent(parsed.event, parsed.data);
        if (event) yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
