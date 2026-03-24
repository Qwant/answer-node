/**
 * Example: non-stream (create) usage.
 *
 * Usage:
 *   API_KEY=xxx npm run example:create
 */

import { AnswerClient, AnswerApiError, AnswerNetworkError } from '../src/index.js';

const client = new AnswerClient({
  apiKey: process.env['API_KEY'] ?? '',
  ...(process.env['API_BASE_URL'] ? { baseURL: process.env['API_BASE_URL'] } : {}),
});

try {
  const result = await client.create({
    query: 'Macbook néo',
    filter: 'frandroid.com',
    markdown: true,
    related_queries: true,
    style: 'editorial',
    language: 'fr',
  });

  console.log('\n=== Answer ===');
  console.log(result.answer);
  console.log('\n=== Sources ===');
  for (const s of result.sources) {
    console.log(`  [${s.id}] ${s.title} — ${s.url}`);
  }
  if (result.related_queries.length > 0) {
    console.log('\n=== Related queries ===');
    for (const q of result.related_queries) {
      console.log(`  - ${q}`);
    }
  }
  if (result.usages.length > 0) {
    console.log('\n=== Usage ===');
    for (const u of result.usages) {
      console.log(`  [${u.step}] in: ${u.input_tokens}, out: ${u.output_tokens}`);
    }
  }
  console.log(`\ngeneration_ms: ${result.generation_ms}`);
} catch (err) {
  if (err instanceof AnswerApiError) {
    console.error(`API error ${err.status}:`, err.body);
  } else if (err instanceof AnswerNetworkError) {
    console.error('Network error:', err.message, err.cause);
  } else {
    throw err;
  }
}
