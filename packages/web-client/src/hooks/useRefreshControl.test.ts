import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	inboxSyncedAt,
	type SyncStatusReading,
	waitForSettled,
} from "./useRefreshControl.js";

const BASELINE = 1_700_000_000_000;
const LATER = BASELINE + 5_000;

/** Replays `readings` in order and holds on the last one, counting reads so a
 * test can say when the wait made up its mind. */
const scriptedReader = (readings: readonly SyncStatusReading[]) => {
	const state = { reads: 0 };
	const readStatus = async (): Promise<SyncStatusReading> => {
		const reading = readings[Math.min(state.reads, readings.length - 1)];
		state.reads += 1;
		if (!reading) throw new Error("no reading scripted");
		return reading;
	};
	return { state, readStatus };
};

const wait = (
	readings: readonly SyncStatusReading[],
	deadline = Date.now() + 10_000,
) => {
	const { state, readStatus } = scriptedReader(readings);
	return {
		state,
		outcome: waitForSettled({
			accountId: "a-1",
			readStatus,
			baselineLastSyncAt: BASELINE,
			deadline,
			pollMs: 0,
		}),
	};
};

describe("waitForSettled", () => {
	// #953: the tab's own background poll, another tab, and every GET /config
	// start rounds the user never clicked for. Seeing one of those in flight and
	// then complete used to be read as confirmation, so the button showed a
	// checkmark and invalidated the list with the clicked round still unrun —
	// new mail stayed unshown until the next poll. Only the account's own
	// round-start stamp moving past the pre-trigger reading counts.
	test("does not confirm on a round that was already in flight at the trigger", async () => {
		const { state, outcome } = wait([
			{ syncPhase: "syncing_inbox", lastSyncAt: BASELINE },
			{ syncPhase: "complete", lastSyncAt: BASELINE },
			{ syncPhase: "complete", lastSyncAt: LATER },
		]);

		assert.equal(await outcome, undefined);
		assert.equal(state.reads, 3);
	});

	test("a settled foreign round times out rather than confirming", async () => {
		const { outcome } = wait(
			[{ syncPhase: "complete", lastSyncAt: BASELINE }],
			Date.now() - 1,
		);

		assert.deepEqual(await outcome, {
			accountId: "a-1",
			message: "Refresh is taking longer than usual",
		});
	});

	test("confirms once the account's own round has started and settled", async () => {
		const { state, outcome } = wait([
			{ syncPhase: "complete", lastSyncAt: LATER },
		]);

		assert.equal(await outcome, undefined);
		assert.equal(state.reads, 1);
	});

	test("reports the failure of a round that started after the trigger", async () => {
		const { outcome } = wait([{ syncPhase: "error", lastSyncAt: LATER }]);

		assert.deepEqual(await outcome, {
			accountId: "a-1",
			message: "Sync failed for this account",
		});
	});

	// The stale-phase half of the same rule: POST /sync only enqueues, so the
	// first reading back can still carry the previous round's error phase.
	test("does not borrow the error phase of a round that predates the trigger", async () => {
		const { outcome } = wait(
			[{ syncPhase: "error", lastSyncAt: BASELINE }],
			Date.now() - 1,
		);

		assert.deepEqual(await outcome, {
			accountId: "a-1",
			message: "Refresh is taking longer than usual",
		});
	});

	test("an account that has never synced confirms on its first stamp", async () => {
		const { state, readStatus } = scriptedReader([
			{ syncPhase: "idle", lastSyncAt: undefined },
			{ syncPhase: "complete", lastSyncAt: LATER },
		]);

		const outcome = await waitForSettled({
			accountId: "a-1",
			readStatus,
			baselineLastSyncAt: 0,
			deadline: Date.now() + 10_000,
			pollMs: 0,
		});

		assert.equal(outcome, undefined);
		assert.equal(state.reads, 2);
	});

	test("surfaces a failed status read", async () => {
		const outcome = await waitForSettled({
			accountId: "a-1",
			readStatus: () => Promise.reject(new Error("signed out")),
			baselineLastSyncAt: BASELINE,
			deadline: Date.now() + 10_000,
			pollMs: 0,
		});

		assert.deepEqual(outcome, { accountId: "a-1", message: "signed out" });
	});
});

const inbox = (lastSyncedAt: number) => ({
	fullPath: "INBOX",
	lastSyncedAt,
});
const junk = (lastSyncedAt: number) => ({
	fullPath: "Junk",
	lastSyncedAt,
});

describe("inboxSyncedAt", () => {
	test("reads the INBOX stamp whatever case the server spells it in", () => {
		assert.equal(
			inboxSyncedAt({
				mailboxes: [junk(LATER), { fullPath: "Inbox", lastSyncedAt: BASELINE }],
			}),
			BASELINE,
		);
	});

	test("is zero for an account with no INBOX or no stamp yet", () => {
		assert.equal(inboxSyncedAt({ mailboxes: [junk(LATER)] }), 0);
		assert.equal(inboxSyncedAt({ mailboxes: [{ fullPath: "INBOX" }] }), 0);
		assert.equal(inboxSyncedAt({}), 0);
	});
});

describe("waitForSettled inbox handoff", () => {
	// A round is every folder in queue order, but the mail somebody pressed
	// refresh for is in their inbox. Waiting for the whole round meant the new
	// mail sat unshown while Junk and Trash went by.
	test("announces the inbox while the round is still running", async () => {
		const announced: number[] = [];
		const { state, readStatus } = scriptedReader([
			{
				syncPhase: "syncing_inbox",
				lastSyncAt: LATER,
				mailboxes: [inbox(BASELINE)],
			},
			{
				syncPhase: "syncing_others",
				lastSyncAt: LATER,
				mailboxes: [inbox(LATER)],
			},
			{
				syncPhase: "syncing_others",
				lastSyncAt: LATER,
				mailboxes: [inbox(LATER)],
			},
			{
				syncPhase: "complete",
				lastSyncAt: LATER,
				mailboxes: [inbox(LATER)],
			},
		]);

		const outcome = await waitForSettled({
			accountId: "a-1",
			readStatus,
			baselineLastSyncAt: BASELINE,
			baselineInboxSyncedAt: BASELINE,
			onInboxSynced: () => announced.push(state.reads),
			deadline: Date.now() + 10_000,
			pollMs: 0,
		});

		assert.equal(outcome, undefined);
		// Second reading, two readings before the round confirmed.
		assert.deepEqual(announced, [2]);
		assert.equal(state.reads, 4);
	});

	test("announces the inbox once, not on every poll", async () => {
		let announced = 0;
		const { readStatus } = scriptedReader([
			{
				syncPhase: "syncing_others",
				lastSyncAt: LATER,
				mailboxes: [inbox(LATER)],
			},
			{
				syncPhase: "syncing_others",
				lastSyncAt: LATER,
				mailboxes: [inbox(LATER)],
			},
			{
				syncPhase: "complete",
				lastSyncAt: LATER,
				mailboxes: [inbox(LATER)],
			},
		]);

		await waitForSettled({
			accountId: "a-1",
			readStatus,
			baselineLastSyncAt: BASELINE,
			baselineInboxSyncedAt: BASELINE,
			onInboxSynced: () => {
				announced += 1;
			},
			deadline: Date.now() + 10_000,
			pollMs: 0,
		});

		assert.equal(announced, 1);
	});

	// The caller already treats a settled round as the confirmed state and
	// reloads there, so announcing on the same reading would double the work.
	test("does not announce when the round settles first", async () => {
		let announced = 0;

		await waitForSettled({
			accountId: "a-1",
			readStatus: async () => ({
				syncPhase: "complete" as const,
				lastSyncAt: LATER,
				mailboxes: [inbox(LATER)],
			}),
			baselineLastSyncAt: BASELINE,
			baselineInboxSyncedAt: BASELINE,
			onInboxSynced: () => {
				announced += 1;
			},
			deadline: Date.now() + 10_000,
			pollMs: 0,
		});

		assert.equal(announced, 0);
	});

	// A folder other than INBOX syncing is not the mail being waited for.
	test("does not announce on another folder's stamp moving", async () => {
		let announced = 0;

		await waitForSettled({
			accountId: "a-1",
			readStatus: async () => ({
				syncPhase: "syncing_others" as const,
				lastSyncAt: LATER,
				mailboxes: [inbox(BASELINE), junk(LATER)],
			}),
			baselineLastSyncAt: BASELINE,
			baselineInboxSyncedAt: BASELINE,
			onInboxSynced: () => {
				announced += 1;
			},
			deadline: Date.now() - 1,
			pollMs: 0,
		});

		assert.equal(announced, 0);
	});
});
