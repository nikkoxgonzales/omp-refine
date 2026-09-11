/**
 * omp-refine — public surface (also what the acceptance tests import).
 */
export { countTrailingBackslashes, countBackslashesBefore, hasContinuation, hasContinuationAt, stripContinuation, spliceContinuationAt, isContinuationLine, spliceSoleLineContinuation, spliceSoleLineContinuationWithCursor, } from './continuation.js';
export { shouldContinue, resolveBaseText, readCursorOffset, createSubmitSnapshotTap } from './extension.js';
export type { SubmitSnapshotDeps } from './extension.js';
export { createDoubleEscapeHandler, DOUBLE_ESCAPE_MS, ESCAPE_KEY, } from './double-escape.js';
export type { DoubleEscapeDeps } from './double-escape.js';
