export const DEFAULT_TICK_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_OFFLINE_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Page size + enqueue concurrency are implementation details of the tick
// itself, not stage config — unlike the two intervals above, nothing outside
// this worker needs to agree with them.
export const SCHEDULER_PAGE_SIZE = 100;
export const SCHEDULER_ENQUEUE_CONCURRENCY = 10;
