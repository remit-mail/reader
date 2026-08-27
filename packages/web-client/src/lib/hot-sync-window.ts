/**
 * A short window of faster background syncing, opened by a person pressing
 * refresh.
 *
 * Pressing refresh says "I am waiting on mail", and the reply people expect is
 * not one round but the next few minutes: a reply lands, a colleague answers,
 * the transfer confirms. The ambient cadence alone would leave that mail up to
 * a full interval away, so the press widens the tab's own poll for a few
 * minutes and then lets it fall back.
 *
 * Module state rather than context: the press happens in the refresh control
 * and the polling happens in `useStaleAccountSync`, two hooks with no common
 * ancestor that owns this, and the window belongs to the tab either way.
 */

/** How long a press keeps the tab polling on the hot cadence. */
export const HOT_WINDOW_MS = 3 * 60 * 1000;

/** The cadence inside the window. Never faster: `POST /sync` skips the
 * server's per-mailbox freshness gate, so every tick is a real folder-by-folder
 * fan-out for every open account. */
export const HOT_POLL_INTERVAL_MS = 30 * 1000;

let hotUntil = 0;
const listeners = new Set<() => void>();

/** Open (or re-open) the window. Called on a refresh press, never on a timer. */
export const startHotSyncWindow = (now: number = Date.now()): void => {
	hotUntil = now + HOT_WINDOW_MS;
	for (const listener of listeners) listener();
};

export const isHotSyncWindowActive = (now: number = Date.now()): boolean =>
	now < hotUntil;

/** Notifies on every press so a poll loop already asleep on the ambient
 * interval can reschedule onto the hot one instead of finishing its long wait
 * first. */
export const subscribeHotSyncWindow = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const __resetHotSyncWindow = (): void => {
	hotUntil = 0;
};
