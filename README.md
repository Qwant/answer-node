# @qwant/answer

TypeScript SDK for the Qwant Answers API (`POST /v2/answer`).

Handles fetch, SSE parsing, partial-chunk buffering, event routing, and stream cancellation.

## Requirements

- Node.js ≥ 18
- No runtime dependencies

## Installation

```bash
npm install @qwant/answer
```

## Usage

```ts
import { AnswerClient } from '@qwant/answer';

const client = new AnswerClient({ apiKey: process.env.API_KEY });
```

### Non-streaming

```ts
const result = await client.create({
  query: 'Macbook néo',
  filter: 'frandroid.com',
  markdown: true,
  related_queries: true,
});

console.log(result.answer);
console.log(result.sources);
```

### Streaming

```ts
const stream = client.stream({
  query: 'MacBook Neo',
  filter: 'frandroid.com',
  markdown: true,
  style: 'editorial',
  language: 'fr',
});

// Synchronous callback (useful for partial rendering)
stream.onEvent((event) => {
  if (event.type === 'assistant') process.stdout.write(event.delta);
});

// Async iterator (main path)
for await (const event of stream) {
  if (event.type === 'sources') console.log('Sources:', event.sources);
  if (event.type === 'done')    console.log('Done:', event.finish_reason);
}
```

`onEvent` and `for await` are two independent views of the same stream.

### Cancellation

```ts
const stream = client.stream({ query: '...' });

// Via the method
setTimeout(() => stream.cancel(), 2000);

// Via AbortSignal
const ac = new AbortController();
const stream = client.stream({ query: '...' }, { signal: ac.signal });

// Exiting the for-await loop automatically cancels the HTTP request
```

## API

### `new AnswerClient(opts)`

| Option | Type | Default |
|--------|------|---------|
| `apiKey` | `string` | — |
| `baseURL` | `string` | `'https://api.staan.ai/v2'` |

### `client.create(input, signal?): Promise<AnswerV2Result>`

Returns the full response (non-streaming).

### `client.stream(input, opts?): StreamHandle`

Returns a `StreamHandle`:

| Member | Description |
|--------|-------------|
| `for await (const event of stream)` | Async iterator |
| `stream.onEvent(handler)` | Synchronous callback, returns an unsubscribe function |
| `stream.cancel()` | Cancels the HTTP request |

## Stream events

| Type | Payload |
|------|---------|
| `sources` | `{ sources: AnswerV2Source[] }` |
| `assistant` | `{ delta: string }` |
| `citation` | `{ reference_ids: number[] }` |
| `usages` | `{ usages: AnswerV2UsageEntry[] }` |
| `related` | `{ related_queries: string[] }` |
| `done` | `{ finish_reason: string }` |

## Error handling

```ts
import { AnswerApiError, AnswerNetworkError } from '@qwant/answer';

try {
  await client.create({ query: '...' });
} catch (err) {
  if (err instanceof AnswerApiError)     console.error(err.status, err.body);
  if (err instanceof AnswerNetworkError) console.error(err.message, err.cause);
}
```

## Development

```bash
npm install
npm run build
npm run typecheck
```

```bash
API_KEY=xxx npm run example:create
API_KEY=xxx npm run example:stream
API_KEY=xxx npm run example:cancel
```

## License

MIT
