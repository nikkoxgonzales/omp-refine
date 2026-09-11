/**
 * omp-refine — public surface (also what the acceptance tests import).
 */
export { countTrailingBackslashes, hasContinuation, stripContinuation, } from './continuation.js';
export { shouldContinue } from './extension.js';
export { createDoubleEscapeHandler, DOUBLE_ESCAPE_MS, ESCAPE_KEY, } from './double-escape.js';
export type { DoubleEscapeDeps } from './double-escape.js';
