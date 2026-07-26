import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	FIFO_RECEIVE_VISIBILITY_SECONDS,
	receiveVisibilitySeconds,
	STANDARD_RECEIVE_VISIBILITY_SECONDS,
} from "./e2e-processor-visibility.js";

describe("receiveVisibilitySeconds", () => {
	it("gives the per-account FIFO sync queues a short window so a failure unblocks fast", () => {
		for (const url of [
			"http://localhost:9324/000/remit-mailboxes.fifo",
			"http://localhost:9324/000/remit-messages.fifo",
			"http://localhost:9324/000/remit-flags.fifo",
		]) {
			assert.equal(
				receiveVisibilitySeconds(url),
				FIFO_RECEIVE_VISIBILITY_SECONDS,
			);
		}
	});

	it("keeps the long window for the standard body and management queues", () => {
		for (const url of [
			"http://localhost:9324/000/remit-body",
			"http://localhost:9324/000/remit-mailbox-mgmt",
			"http://localhost:9324/000/remit-message-mgmt",
			"http://localhost:9324/000/remit-search-index",
		]) {
			assert.equal(
				receiveVisibilitySeconds(url),
				STANDARD_RECEIVE_VISIBILITY_SECONDS,
			);
		}
	});

	it("keeps the FIFO window short enough to unblock within a spec's seed budget, above a sync round's own duration", () => {
		assert.ok(FIFO_RECEIVE_VISIBILITY_SECONDS > 0);
		assert.ok(
			FIFO_RECEIVE_VISIBILITY_SECONDS < STANDARD_RECEIVE_VISIBILITY_SECONDS,
		);
	});
});
