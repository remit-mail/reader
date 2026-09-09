/**
 * The doors onto a folder's mutation state, proved by the compiler.
 *
 * `docs/architecture/folder-rename-and-delete.md` D3 says every transition of a
 * folder's state is a conditional write. A rule like that is worth exactly as
 * much as the thing enforcing it, and a convention enforces nothing: every
 * writer in the tree before this reached for the general-purpose `update()`,
 * because nothing stopped them.
 *
 * So `syncStatus` and `pendingPath` are gone from `UpdateMailboxInput`, and
 * `pendingPath` from `CreateMailboxInput` too — a create records no rename
 * target (T1). What is left is `transition` and `transitionSubtree`, both of
 * which take a predicate. Every `@ts-expect-error` below is a door that is
 * shut: put the field back and these stop erroring, which fails the build.
 *
 * `@ts-expect-error` is the assertion here, so this file is checked rather than
 * run. The one runtime case exists to keep the suite honest about having loaded
 * it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	CreateMailboxInput,
	MailboxStatePredicate,
	MailboxSubtreeTransitionIntent,
	MailboxTransitionIntent,
	UpdateMailboxInput,
} from "./types.js";

// --- The general-purpose writer refuses both state fields -------------------

// @ts-expect-error `syncStatus` is mutation state: write it through a transition
const syncStatus: UpdateMailboxInput = { syncStatus: "pending" };

// @ts-expect-error `pendingPath` is mutation state
const pendingPath: UpdateMailboxInput = { pendingPath: "Archive/2025" };

// The insert records a state — the intent recorders say which — but never a
// rename target, because a create has none.
const created: CreateMailboxInput = {
	accountId: "acct-1",
	namespacePrefix: "",
	hierarchyDelimiter: "/",
	fullPath: "Archive",
	uidValidity: 1,
	uidNext: 1,
	highestModseq: "0",
	messageCount: 0,
	unseenCount: 0,
	deletedCount: 0,
	totalSize: 0,
	lastSyncUid: 0,
	highWaterMarkUid: 0,
	lastMessageSyncAt: 0,
	syncStatus: "pending",
};

// @ts-expect-error a create records no rename target (T1)
const createdWithTarget: CreateMailboxInput = { ...created, pendingPath: "X" };

// Everything else about a folder still goes through `update()`, unchanged.
const ordinary: UpdateMailboxInput = {
	fullPath: "Archive/2025",
	messageCount: 12,
	cursorState: "cursor_invalid",
};

// --- The transitions are the doors, and they take a predicate ---------------

const transition: MailboxTransitionIntent = {
	from: ["pending"],
	wherePendingPath: null,
	to: "synced",
	set: { fullPath: "INBOX/Archive", pendingPath: null },
};

const subtree: MailboxSubtreeTransitionIntent = {
	from: ["synced", "failed"],
	to: "pending",
	rowSet: (row) => ({ pendingPath: row.fullPath }),
};

// The predicate names states, never a free-form column: a caller cannot smuggle
// an unrelated field into the WHERE clause and call it a lock.
const notAState: MailboxStatePredicate = {
	from: ["synced"],
	// @ts-expect-error `fullPath` is not part of a folder's mutation state
	fullPath: "INBOX",
};

test("the folder-state doors are the two transitions", () => {
	assert.equal(transition.to, "synced");
	assert.equal(
		subtree.rowSet({ fullPath: "Work" } as never).pendingPath,
		"Work",
	);
	assert.equal(ordinary.messageCount, 12);
	assert.deepEqual(
		[syncStatus, pendingPath, createdWithTarget, notAState].length,
		4,
		"each field taken off an input, and the predicate's own shape, is pinned above",
	);
});
