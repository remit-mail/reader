/**
 * The two data migrations this release carries, against a database written by
 * the build before it.
 *
 * Both exist because a predicate changed meaning under rows already on disk.
 * `carriesForeignUid` reads `originalUid` without consulting `status`, so a
 * settled row that a pre-#1217 build left one on answers "this uid belongs to
 * another folder" forever — and Empty Trash refuses to remove it after the
 * server copy is gone (reader#1230). And the give-up signal moved from
 * `active` + `failed` to its own value, so an abandoned delete written before
 * the upgrade would go quiet: the row stays where it was handed back and the
 * user is told nothing.
 *
 * Applied through the shipped journal rather than a schema pushed from the
 * table objects, because a data migration that never runs is exactly the
 * failure being pinned.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import Database from "better-sqlite3";
import {
	applyMigration,
	migrationJournal,
} from "../test-shipped-sqlite-schema.js";

const STALE_ORIGINAL_UID = "msg-stale-original-uid";
const IN_FLIGHT = "msg-in-flight";
const GAVE_UP = "msg-gave-up";
const RETRYING_DELETE = "msg-retrying-delete";

/** The migration that clears a settled row's stale `original_uid`. */
const ORIGINAL_UID_BACKFILL = 24;

/** The migration that carries an abandoned delete onto the give-up value. */
const GIVE_UP_BACKFILL = 25;

interface MessageRow {
	message_id: string;
	status: string;
	sync_status: string;
	abandoned_mutation: string;
	original_uid: number | null;
	original_mailbox_id: string | null;
}

describe("the placement backfills carry a pre-upgrade database forward", () => {
	let sqlite: Database.Database;

	const rowFor = (messageId: string): MessageRow =>
		sqlite
			.prepare("SELECT * FROM message WHERE message_id = ?")
			.get(messageId) as MessageRow;

	before(() => {
		sqlite = new Database(":memory:");
		const entries = migrationJournal();

		// Everything the previous release shipped, and nothing this one adds.
		for (const entry of entries.filter(
			(candidate) => candidate.idx < ORIGINAL_UID_BACKFILL,
		)) {
			applyMigration(sqlite, entry.tag);
		}

		const insert = sqlite.prepare(
			`INSERT INTO message (
				message_id, mailbox_id, uid, sequence_number, rfc822_size,
				internal_date, envelope_id, root_body_part_id,
				status, sync_status, original_mailbox_id, original_uid,
				created_at, updated_at
			) VALUES (?, ?, ?, 1, 100, 0, ?, ?, ?, ?, ?, ?, 0, 0)`,
		);

		// Settled, with the `original_uid` a pre-#1217 `updateUid` left behind —
		// and Trash handing back the source's own number, which on a young
		// account is the common case rather than the exotic one.
		insert.run(
			STALE_ORIGINAL_UID,
			"mbx-trash",
			10,
			`env-${STALE_ORIGINAL_UID}`,
			`bp-${STALE_ORIGINAL_UID}`,
			"active",
			"synced",
			"mbx-inbox",
			10,
		);

		// Genuinely mid-move: this row's `original_uid` is not stale and must
		// survive, or the guard that stops a move binding somebody else's uid
		// stops working on every row the upgrade touched.
		insert.run(
			IN_FLIGHT,
			"mbx-archive",
			42,
			`env-${IN_FLIGHT}`,
			`bp-${IN_FLIGHT}`,
			"moving",
			"pending",
			"mbx-inbox",
			42,
		);

		// The pair a give-up wrote before this release. Two writers produced it —
		// `abandonDelete` and the paused-cursor hand-back for an unproven MOVE —
		// through the identical `restoreSourcePlacement` call, so the row cannot
		// say which.
		insert.run(
			GAVE_UP,
			"mbx-inbox",
			7,
			`env-${GAVE_UP}`,
			`bp-${GAVE_UP}`,
			"active",
			"failed",
			"mbx-inbox",
			null,
		);

		// A transient attempt with a redelivery behind it. It writes the same
		// `failed`, and keeping `deleting` beside it is the only thing that tells
		// the two apart — so the backfill must not touch it.
		insert.run(
			RETRYING_DELETE,
			"mbx-trash",
			8,
			`env-${RETRYING_DELETE}`,
			`bp-${RETRYING_DELETE}`,
			"deleting",
			"failed",
			"mbx-inbox",
			8,
		);

		for (const entry of entries.filter(
			(candidate) => candidate.idx >= ORIGINAL_UID_BACKFILL,
		)) {
			applyMigration(sqlite, entry.tag);
		}
	});

	after(() => {
		sqlite.close();
	});

	test("the journal ships both backfills", () => {
		const idxs = migrationJournal().map((entry) => entry.idx);
		assert.ok(idxs.includes(ORIGINAL_UID_BACKFILL));
		assert.ok(idxs.includes(GIVE_UP_BACKFILL));
	});

	test("a settled row loses the stale uid that made it look foreign", () => {
		const row = rowFor(STALE_ORIGINAL_UID);
		assert.equal(row.original_uid, null);
		assert.equal(
			row.original_mailbox_id,
			"mbx-inbox",
			"Undo still restores to the folder the message came from",
		);
	});

	test("a row still mid-move keeps the uid its guard depends on", () => {
		assert.equal(rowFor(IN_FLIGHT).original_uid, 42);
	});

	test("a give-up keeps its chip, on the value the client now reads", () => {
		const row = rowFor(GAVE_UP);
		assert.equal(row.sync_status, "abandoned");
		assert.equal(row.status, "active");
	});

	/**
	 * The two pre-upgrade writers are indistinguishable in the row, so the
	 * backfill has to pick one label for both. It picks the survivable mistake:
	 * a wrongly-labelled move offers a folder picker the user can dismiss, while
	 * a wrongly-labelled delete offers a button that destroys the message — the
	 * #1229 defect, on a press the user believed was a repair.
	 */
	test("and is never labelled a delete, which would offer to destroy it", () => {
		assert.equal(rowFor(GAVE_UP).abandoned_mutation, "move");
	});

	test("a delete mid-retry is left exactly as it was", () => {
		const row = rowFor(RETRYING_DELETE);
		assert.equal(row.sync_status, "failed");
		assert.equal(row.abandoned_mutation, "none");
		assert.equal(row.status, "deleting");
	});
});
