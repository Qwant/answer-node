/**
 * Example: cancelling a stream after 2 seconds.
 *
 * Usage:
 *   API_KEY=xxx npm run example:cancel
 */

import { AnswerClient } from '../src/index.js';

const client = new AnswerClient({
  apiKey: process.env['API_KEY'] ?? '',
  ...(process.env['API_BASE_URL'] ? { baseURL: process.env['API_BASE_URL'] } : {}),
});

const stream = client.stream({
  query: 'Macbook néo',
  filter: 'frandroid.com',
  markdown: true,
  mode: 'long',
});

// Cancel after 2 s
const timeout = setTimeout(() => {
  console.error('\n[cancel] Aborting stream after 2s...');
  stream.cancel();
}, 2000);

try {
  for await (const event of stream) {
    if (event.type === 'assistant') {
      process.stdout.write(event.delta);
    } else if (event.type === 'done') {
      console.error(`\n[done] ${event.finish_reason}`);
    }
  }
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    console.error('\n[cancelled] Stream was aborted.');
  } else {
    throw err;
  }
} finally {
  clearTimeout(timeout);
}
