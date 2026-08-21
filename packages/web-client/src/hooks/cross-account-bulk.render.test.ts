/**
 * The brief and Flagged are the two cross-account lists, and both offer Delete
 * and Mark read over whatever is ticked (#872).
 *
 * The bulk endpoints refuse a batch spanning accounts before applying any of
 * it, so a selection with one row from each account deleted nothing at all and
 * marked nothing read — the user got "Couldn't delete these messages" and no
 * mail moved. The split has to happen where the call is made, so this mounts
 * the real hook against the real fetch seam and reads the requests that
 * actually left: every batch carries one account, and between them they carry
 * every ticked row.
 *
 * Which account each ticked row belongs to is the surfaces' half of the same
 * fix, and it is pinned in `../lib/wizard-selection.test.ts`. How the run
 * sequences the batches it splits into — progress over the whole selection,
 * cancellation at whichever boundary comes next — is `../lib/bulk-actions.test.ts`,
 * where a batch is a value rather than a request in flight.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import type { BulkActionTarget } from "../lib/bulk-actions";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../test-support/http";
import {
	type EscalatedAction,
	type UseEscalatedActionsResult,
	useEscalatedActions,
} from "./useEscalatedActions";

const ACCOUNT_A = "acc-work";
const ACCOUNT_B = "acc-personal";

/** A brief selection: two rows from one account, one from another. */
const MIXED: BulkActionTarget[] = [
	{ id: "msg-work-1", accountId: ACCOUNT_A },
	{ id: "msg-personal-1", accountId: ACCOUNT_B },
	{ id: "msg-work-2", accountId: ACCOUNT_A },
];

let harness: DomHarness | undefined;
let http: HttpMock;

const mountRunner = (): (() => UseEscalatedActionsResult) => {
	let value: UseEscalatedActionsResult | undefined;
	const Probe = () => {
		value = useEscalatedActions({
			// The brief's selection belongs to no single mailbox, which is how the
			// wizard mounts this hook over a cross-account list.
			mailboxId: "",
			enabled: false,
			predicateKey: "selection-wizard",
			searchQuery: {},
		});
		return null;
	};
	harness = createDomHarness();
	harness.renderApp(createElement(Probe));
	return () => {
		if (!value) throw new Error("hook did not render");
		return value;
	};
};

/** Enough turns for a run of sequential batches to finish. */
const settle = async (): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 10; round += 1) await harness.flush();
};

const run = async (
	hook: () => UseEscalatedActionsResult,
	action: EscalatedAction,
	targets: readonly BulkActionTarget[],
) => {
	let started: ReturnType<UseEscalatedActionsResult["runAction"]> | undefined;
	act(() => {
		started = hook().runAction(action, targets);
	});
	await settle();
	if (!started) throw new Error("the run never started");
	return started;
};

/** The message-id list of every bulk request that left, in order. */
const batches = (suffix: string): string[][] =>
	http
		.to(suffix)
		.map((call) => (call.body as { messageIds?: string[] })?.messageIds ?? []);

const accountOf = (id: string): string | undefined =>
	MIXED.find((target) => target.id === id)?.accountId;

const assertOneBatchPerAccount = (sent: string[][]): void => {
	assert.equal(sent.length, 2, "the selection was not split by account");
	for (const batch of sent) {
		assert.equal(
			new Set(batch.map(accountOf)).size,
			1,
			"a batch spanned accounts, which the endpoint refuses whole",
		);
	}
	assert.deepEqual(
		[...sent.flat()].sort(),
		MIXED.map((target) => target.id).sort(),
		"a ticked row was never sent",
	);
};

beforeEach(() => {
	http = mockFetch(() => ({ successCount: 1, failureCount: 0 }));
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

describe("a selection spanning accounts", () => {
	it("deletes every ticked row, one batch per account", async () => {
		const hook = mountRunner();

		const outcome = await run(hook, { kind: "delete" }, MIXED);

		assertOneBatchPerAccount(batches("/messages/delete"));
		assert.equal(outcome.done, MIXED.length);
		assert.deepEqual(outcome.failedIds, []);
	});

	it("marks every ticked row read, one batch per account", async () => {
		const hook = mountRunner();

		const outcome = await run(hook, { kind: "markRead" }, MIXED);

		assertOneBatchPerAccount(batches("/messages/flags"));
		for (const call of http.calls) {
			assert.equal((call.body as { isRead?: boolean })?.isRead, true);
		}
		assert.equal(outcome.done, MIXED.length);
	});

	it("reports how far it got when one account's batch fails", async () => {
		http.restore();
		http = mockFetch((call) =>
			(call.body as { messageIds?: string[] })?.messageIds?.[0] ===
			"msg-personal-1"
				? httpError(409, "mailbox is locked")
				: { successCount: 1, failureCount: 0 },
		);
		const hook = mountRunner();

		const outcome = await run(hook, { kind: "delete" }, MIXED);

		assert.equal(outcome.done, 2, "the account that succeeded is not counted");
		assert.deepEqual(
			outcome.failedIds,
			["msg-personal-1"],
			"the untouched rows are not handed back to retry",
		);
		assert.notEqual(outcome.error, undefined);
	});
});
