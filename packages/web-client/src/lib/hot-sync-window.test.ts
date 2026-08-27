import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
	__resetHotSyncWindow,
	HOT_POLL_INTERVAL_MS,
	HOT_WINDOW_MS,
	isHotSyncWindowActive,
	startHotSyncWindow,
	subscribeHotSyncWindow,
} from "./hot-sync-window.js";

const NOW = 1_700_000_000_000;

describe("hot sync window", () => {
	afterEach(__resetHotSyncWindow);

	test("is closed until somebody presses refresh", () => {
		assert.equal(isHotSyncWindowActive(NOW), false);
	});

	test("stays open for a few minutes after a press", () => {
		startHotSyncWindow(NOW);

		assert.equal(isHotSyncWindowActive(NOW), true);
		assert.equal(isHotSyncWindowActive(NOW + HOT_WINDOW_MS - 1), true);
	});

	test("expires on its own", () => {
		startHotSyncWindow(NOW);

		assert.equal(isHotSyncWindowActive(NOW + HOT_WINDOW_MS), false);
		assert.equal(isHotSyncWindowActive(NOW + HOT_WINDOW_MS + 1), false);
	});

	// Someone still pressing refresh is still waiting on mail.
	test("a second press extends the window from that press", () => {
		startHotSyncWindow(NOW);
		startHotSyncWindow(NOW + 60_000);

		assert.equal(isHotSyncWindowActive(NOW + HOT_WINDOW_MS), true);
		assert.equal(isHotSyncWindowActive(NOW + HOT_WINDOW_MS + 60_000), false);
	});

	// The poll loop may already be asleep on a long ambient interval when the
	// press lands; without this it would sit out the rest of that wait before
	// the hot cadence took effect at all.
	test("notifies subscribers on a press, and stops after unsubscribe", () => {
		let presses = 0;
		const unsubscribe = subscribeHotSyncWindow(() => {
			presses += 1;
		});

		startHotSyncWindow(NOW);
		assert.equal(presses, 1);

		unsubscribe();
		startHotSyncWindow(NOW);
		assert.equal(presses, 1);
	});

	test("the hot cadence is thirty seconds", () => {
		assert.equal(HOT_POLL_INTERVAL_MS, 30_000);
	});
});
