/**
 * Thrown when the server returns a non-2xx HTTP response.
 */
export class AnswerApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Qwant Answers API error: HTTP ${status}`);
    this.name = 'AnswerApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Thrown on network-level failures (fetch threw, stream died, etc.).
 * AbortError is NOT wrapped — it propagates as-is.
 */
export class AnswerNetworkError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'AnswerNetworkError';
    this.cause = cause;
  }
}
