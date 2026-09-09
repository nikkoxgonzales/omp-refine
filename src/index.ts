/**
 * omp-hotkeys — public surface (also what the acceptance tests import).
 */
export {
  countTrailingBackslashes,
  hasContinuation,
  stripContinuation,
} from './continuation.js';
export { shouldContinue } from './extension.js';
