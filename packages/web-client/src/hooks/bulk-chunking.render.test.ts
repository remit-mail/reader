/**
 * The bulk endpoints cap a call at 100 message ids, so the hooks that send a
 * whole selection have to split it. Select-all over the brief's 200-result
 * unscoped search is the reachable case: one call of 200 is a 400, and a
 * mutation 4xx escalates to the fatal error overlay (#453).
 *
 * These mount the real hooks against the real fetch seam and read the requests
 * that actually left, so the boundary is pinned where the call is made rather
 * than at whichever surface assembled the selection.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { BULK_ACTION_CHUNK_SIZE } from "../lib/bulk-actions";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../test-support/http";
import { useApplyLabel } from "./useApplyLabel";
import { useDeleteMessages } from "./useDeleteMessages";
import { useToggleReadFor } from "./useMarkAsRead";
import { useMoveMessages } from "./useMoveMessages";

const INBOX = "mbx-inbox";
const ARCHIVE = "mbx-archive";

let harness: DomHarness | undefined;
let http: HttpMock;

const ids = (count: number): string[] =>
	Array.from({ length: count }, (_, i) => `msg-${i}`);

const mountHook = <T>(useHook: () => T): (() => T) => {
	let value: T | undefined;
	const Probe = () => {
		value = useHook();
		return null;
	};
	harness = createDomHarness();
	harness.renderApp(createElement(Probe));
	return () => {
		if (value === undefined) throw new Error("hook did not render");
		return value;
	};
};

/** Enough turns for a run of sequential chunks to finish. */
const settle = async (): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 8; round += 1) await harness.flush();
};

/** The message-id list of every request that left, in the order they left. */
const sentBatches = (): string[][] =>
	http.calls.map(
		(call) => (call.body as { messageIds?: string[] })?.messageIds ?? [],
	);

const sentSizes = (): number[] => sentBatches().map((batch) => batch.length);

beforeEach(() => {
	http = mockFetch(() => ({}));
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

describe("a bulk selection at the server's cap", () => {
	it("sends exactly 100 ids as one call", async () => {
		const hook = mountHook(() => useDeleteMessages({ mailboxId: INBOX }));

		hook().deleteMessages(ids(BULK_ACTION_CHUNK_SIZE));
		await settle();

		assert.deepEqual(sentSizes(), [BULK_ACTION_CHUNK_SIZE]);
	});

	it("splits 101 ids rather than sending a call the server refuses", async () => {
		const hook = mountHook(() => useDeleteMessages({ mailboxId: INBOX }));

		hook().deleteMessages(ids(BULK_ACTION_CHUNK_SIZE + 1));
		await settle();

		assert.deepEqual(sentSizes(), [BULK_ACTION_CHUNK_SIZE, 1]);
	});

	it("splits a 200-row select-all into two full calls, every id once", async () => {
		const selection = ids(BULK_ACTION_CHUNK_SIZE * 2);
		const hook = mountHook(() => useDeleteMessages({ mailboxId: INBOX }));

		hook().deleteMessages(selection);
		await settle();

		assert.deepEqual(sentSizes(), [
			BULK_ACTION_CHUNK_SIZE,
			BULK_ACTION_CHUNK_SIZE,
		]);
		assert.deepEqual(sentBatches().flat(), selection);
	});

	it("stops at the first refused chunk instead of sending the rest", async () => {
		http.restore();
		http = mockFetch(() => httpError(409, "mailbox is locked"));
		const hook = mountHook(() => useDeleteMessages({ mailboxId: INBOX }));

		hook().deleteMessages(ids(BULK_ACTION_CHUNK_SIZE * 3));
		await settle();

		assert.deepEqual(sentSizes(), [BULK_ACTION_CHUNK_SIZE]);
	});
});

describe("the other verbs a selection reaches", () => {
	it("moves a 200-row selection in chunks, each carrying the destination", async () => {
		const hook = mountHook(() => useMoveMessages({ mailboxId: INBOX }));

		hook().moveMessages(ids(BULK_ACTION_CHUNK_SIZE * 2), ARCHIVE);
		await settle();

		assert.deepEqual(sentSizes(), [
			BULK_ACTION_CHUNK_SIZE,
			BULK_ACTION_CHUNK_SIZE,
		]);
		for (const call of http.calls) {
			assert.equal(
				(call.body as { destinationMailboxId?: string })?.destinationMailboxId,
				ARCHIVE,
			);
		}
	});

	it("marks 101 messages read in chunks, each carrying the flag", async () => {
		const hook = mountHook(() => useToggleReadFor({ mailboxId: INBOX }));

		hook().toggleReadFor(ids(BULK_ACTION_CHUNK_SIZE + 1), true);
		await settle();

		assert.deepEqual(sentSizes(), [BULK_ACTION_CHUNK_SIZE, 1]);
		for (const call of http.calls) {
			assert.equal((call.body as { isRead?: boolean })?.isRead, true);
		}
	});

	it("labels 101 messages in chunks, each carrying the label", async () => {
		const hook = mountHook(() => useApplyLabel({ mailboxId: INBOX }));

		hook().applyLabel(ids(BULK_ACTION_CHUNK_SIZE + 1), "lbl-1", "Apply");
		await settle();

		assert.deepEqual(sentSizes(), [BULK_ACTION_CHUNK_SIZE, 1]);
		for (const call of http.calls) {
			assert.equal((call.body as { labelId?: string })?.labelId, "lbl-1");
		}
	});
});
