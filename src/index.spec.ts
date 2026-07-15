import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnswerClient, AnswerApiError, AnswerNetworkError } from './index.js';
import type { AnswerV2Result } from './types.js';

// ─── SSE helpers ──────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/**
 * Encodes a single SSE block into bytes.
 * The double newline acts as the block separator in the SSE protocol.
 */
function sseChunk(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Builds a ReadableStream that immediately pushes the given chunks
 * and then closes — simulating a complete HTTP response body.
 */
function makeSseStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/**
 * Builds a ReadableStream that hangs forever but errors as soon
 * as the provided AbortSignal fires — used to test cancellation.
 */
function makeHangingStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      signal.addEventListener(
        'abort',
        () => controller.error(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    },
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_RESULT: AnswerV2Result = {
  request_id: 'req_42',
  answer: 'Paris is the capital of France.',
  citations: [{ position: 0, source_id: 'src_1' }],
  related_queries: ['What is the population of Paris?'],
  sources: [{ id: 'src_1', url: 'https://example.com', title: 'Example' }],
  usages: [{ step: 'answer', input_tokens: 10, output_tokens: 20 }],
};

const STREAM_CHUNKS = [
  sseChunk('sources', [{ id: 'src_1', url: 'https://example.com', title: 'Example' }]),
  sseChunk('assistant', 'Paris'),
  sseChunk('citation', { reference_ids: [1] }),
  sseChunk('related', { related_queries: ['What is the population of Paris?'] }),
  sseChunk('done', { finish_reason: 'stop' }),
];

// ─── AnswerClient.create() ────────────────────────────────────────────────────

describe('AnswerClient.create()', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('returns the parsed JSON body on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(MOCK_RESULT), { status: 200 })),
    );

    const client = new AnswerClient({ apiKey: 'test-key' });
    const result = await client.create({ query: 'Capital of France?' });

    expect(result).toEqual(MOCK_RESULT);
  });

  it('sends the correct request — method, auth header, and stream: false in body', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(MOCK_RESULT), { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const client = new AnswerClient({ apiKey: 'my-secret-key' });
    await client.create({ query: 'test', mode: 'long' });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(url).toMatch(/\/answer$/);
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer my-secret-key',
    );
    expect(body.stream).toBe(false);
    expect(body.query).toBe('test');
    expect(body.mode).toBe('long');
  });

  it('throws AnswerApiError with status + body on a 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
      ),
    );

    const client = new AnswerClient({ apiKey: 'bad-key' });
    const err = await client.create({ query: 'test' }).catch((e) => e);

    expect(err).toBeInstanceOf(AnswerApiError);
    expect(err.status).toBe(401);
    expect(err.body).toEqual({ message: 'Unauthorized' });
  });

  it('throws AnswerApiError even when the error body is plain text (not JSON)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    );

    const client = new AnswerClient({ apiKey: 'test' });
    const err = await client.create({ query: 'test' }).catch((e) => e);

    expect(err).toBeInstanceOf(AnswerApiError);
    expect(err.status).toBe(500);
  });

  it('throws AnswerNetworkError when the network is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const client = new AnswerClient({ apiKey: 'test' });
    const err = await client.create({ query: 'test' }).catch((e) => e);

    expect(err).toBeInstanceOf(AnswerNetworkError);
  });

  it('lets AbortError bubble up unwrapped when the caller cancels', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const client = new AnswerClient({ apiKey: 'test' });
    const err = await client.create({ query: 'test' }).catch((e) => e);

    expect(err).toBe(abortError);
    expect(err.name).toBe('AbortError');
  });
});

// ─── AnswerClient.stream() ───────────────────────────────────────────────────

describe('AnswerClient.stream()', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('yields all SSE events in the correct order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(makeSseStream(...STREAM_CHUNKS), { status: 200 })),
    );

    const client = new AnswerClient({ apiKey: 'test' });
    const events = [];
    for await (const event of client.stream({ query: 'test' })) {
      events.push(event);
    }

    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({ type: 'sources' });
    expect(events[1]).toEqual({ type: 'assistant', delta: 'Paris' });
    expect(events[2]).toEqual({ type: 'citation', reference_ids: [1] });
    expect(events[3]).toEqual({
      type: 'related',
      related_queries: ['What is the population of Paris?'],
    });
    expect(events[4]).toEqual({ type: 'done', finish_reason: 'stop' });
  });

  it('onEvent() receives every event in parallel with for-await', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(makeSseStream(...STREAM_CHUNKS), { status: 200 })),
    );

    const client = new AnswerClient({ apiKey: 'test' });
    const stream = client.stream({ query: 'test' });

    const callbackEvents: string[] = [];
    stream.onEvent((e) => callbackEvents.push(e.type));

    // Consume via for-await at the same time
    const forAwaitEvents: string[] = [];
    for await (const e of stream) {
      forAwaitEvents.push(e.type);
    }

    expect(callbackEvents).toEqual(forAwaitEvents);
    expect(callbackEvents).toEqual(['sources', 'assistant', 'citation', 'related', 'done']);
  });

  it('onEvent() unsubscribe prevents further callbacks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          makeSseStream(sseChunk('assistant', 'hello'), sseChunk('assistant', 'world')),
          { status: 200 },
        ),
      ),
    );

    const client = new AnswerClient({ apiKey: 'test' });
    const stream = client.stream({ query: 'test' });

    const received: string[] = [];
    const unsub = stream.onEvent((e) => {
      if (e.type === 'assistant') received.push(e.delta);
    });
    unsub(); // unsubscribe before any event arrives

    for await (const _ of stream) {
      // consume
    }

    expect(received).toHaveLength(0);
  });

  /**
   * Real-world scenario: the network splits a single SSE block across
   * two TCP packets. The SDK must buffer correctly and emit one clean event.
   */
  it('reassembles an SSE block split across multiple TCP chunks', async () => {
    const fullBlock = `event: assistant\ndata: "hello from Paris"\n\n`;
    const splitAt = Math.floor(fullBlock.length / 2);
    const chunk1 = encoder.encode(fullBlock.slice(0, splitAt));
    const chunk2 = encoder.encode(fullBlock.slice(splitAt));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(makeSseStream(chunk1, chunk2), { status: 200 }),
      ),
    );

    const client = new AnswerClient({ apiKey: 'test' });
    const events = [];
    for await (const event of client.stream({ query: 'test' })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'assistant', delta: 'hello from Paris' });
  });

  it('throws AnswerApiError (not a generic error) when the server returns 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
      ),
    );

    const client = new AnswerClient({ apiKey: 'bad' });
    const err = await (async () => {
      for await (const _ of client.stream({ query: 'test' })) {
        // should never reach here
      }
    })().catch((e) => e);

    expect(err).toBeInstanceOf(AnswerApiError);
    expect(err.status).toBe(401);
  });

  it('cancel() stops iteration and throws AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) =>
        Promise.resolve(
          new Response(makeHangingStream(init.signal as AbortSignal), { status: 200 }),
        ),
      ),
    );

    const client = new AnswerClient({ apiKey: 'test' });
    const stream = client.stream({ query: 'test' });

    const iterPromise = (async () => {
      for await (const _ of stream) {
        // waiting for events that never come
      }
    })();

    // Let the background fetch start
    await Promise.resolve();

    stream.cancel();

    await expect(iterPromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('breaking out of for-await aborts the underlying HTTP request', async () => {
    let capturedSignal: AbortSignal | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        return Promise.resolve(
          new Response(makeSseStream(...STREAM_CHUNKS), { status: 200 }),
        );
      }),
    );

    const client = new AnswerClient({ apiKey: 'test' });

    for await (const event of client.stream({ query: 'test' })) {
      if (event.type === 'sources') break; // stop after the very first event
    }

    expect(capturedSignal?.aborted).toBe(true);
  });
});
