/**
 * Example: streaming with onEvent + for-await.
 *
 * Usage:
 *   API_KEY=xxx npm run example:stream
 */

import { AnswerClient, AnswerApiError, AnswerNetworkError } from '../src/index.js';

const client = new AnswerClient({
  apiKey: process.env['API_KEY'] ?? '',
  ...(process.env['API_BASE_URL'] ? { baseURL: process.env['API_BASE_URL'] } : {}),
});

const stream = client.stream({
  query: 'Macbook néo',
  filter: 'frandroid.com',
  markdown: true,
  related_queries: true,
  style: 'editorial',
  language: 'fr',
});

// onEvent: synchronous side-channel — useful for partial rendering
const unsubscribe = stream.onEvent((event) => {
  if (event.type === 'assistant') {
    process.stdout.write(event.delta);
  }
});

try {
  for await (const event of stream) {
    switch (event.type) {
      case 'sources':
        console.error('\n[sources]', event.sources.map((s) => s.title).join(', '));
        break;
      case 'citation':
        // inline — already handled in text
        break;
      case 'related':
        console.error('\n[related]', event.related_queries.join(' | '));
        break;
      case 'usages':
        for (const u of event.usages) {
          console.error(`\n[usage] ${u.step} — in: ${u.input_tokens}, out: ${u.output_tokens}`);
        }
        break;
      case 'done':
        console.error(`\n[done] finish_reason: ${event.finish_reason}`);
        break;
    }
  }
} catch (err) {
  if (err instanceof AnswerApiError) {
    console.error(`\nAPI error ${err.status}:`, err.body);
  } else if (err instanceof AnswerNetworkError) {
    console.error('\nNetwork error:', err.message);
  } else {
    throw err;
  }
} finally {
  unsubscribe();
}
