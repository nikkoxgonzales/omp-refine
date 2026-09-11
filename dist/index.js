/**
 * omp-refine — public surface (also what the acceptance tests import).
 */
export { countTrailingBackslashes, countBackslashesBefore, hasContinuation, hasContinuationAt, stripContinuation, spliceContinuationAt, } from './continuation.js';
export { shouldContinue, resolveBaseText, readCursorOffset, createSubmitSnapshotTap } from './extension.js';
export { createDoubleEscapeHandler, DOUBLE_ESCAPE_MS, ESCAPE_KEY, } from './double-escape.js';
