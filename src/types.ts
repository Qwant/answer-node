// ─── Request ──────────────────────────────────────────────────────────────────

export type AnswerV2Input = {
  /** User question (required). */
  query: string;
  /** Canonical domain filter for search, without www or URL scheme — e.g. `'example.com'`. */
  filter?: string;
  /** Conversation history (max 20 messages). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Response length. Default: `'short'`. */
  mode?: 'short' | 'long';
  /** Answer language. Default: `'fr'`. */
  language?: 'fr' | 'en';
  /** Whether the response uses Markdown formatting. Default: `false`. */
  markdown?: boolean;
  /** Whether to generate related follow-up questions. Default: `false`. */
  related_queries?: boolean;
  /** Whether to rewrite the query before search. Default: `true`. */
  query_rewrite?: boolean;
  /** Caller-supplied sources — bypasses Bloom search when provided. Max 10. */
  sources?: Array<{ url?: string; content?: string; title?: string }>;
  /** How to handle caller-supplied sources. Default: `'search'`. */
  sources_mode?: 'search' | 'context';
};

// ─── Non-stream response ──────────────────────────────────────────────────────

export type AnswerV2Source = {
  id: string;
  url: string;
  title: string;
};

export type AnswerV2UsageEntry = {
  step: 'answer' | 'query_rewrite' | 'related';
  input_tokens: number;
  output_tokens: number;
};

export type AnswerV2Citation = {
  position: number;
  source_id: string;
};

export type AnswerV2Result = {
  request_id: string;
  answer: string;
  citations: AnswerV2Citation[];
  related_queries: string[];
  sources: AnswerV2Source[];
  usages: AnswerV2UsageEntry[];
};

// ─── Stream events ────────────────────────────────────────────────────────────

export type AnswerV2Event =
  | { type: 'sources'; sources: AnswerV2Source[] }
  | { type: 'assistant'; delta: string }
  | { type: 'citation'; reference_ids: number[] }
  | { type: 'related'; related_queries: string[] }
  | { type: 'done'; finish_reason: string };

// ─── Stream handle ────────────────────────────────────────────────────────────

export type StreamHandle = AsyncIterable<AnswerV2Event> & {
  /** Register a synchronous event handler. Returns an unsubscribe function. */
  onEvent(handler: (event: AnswerV2Event) => void): () => void;
  /** Abort the underlying HTTP request. */
  cancel(): void;
};
