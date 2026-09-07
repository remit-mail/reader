/**
 * The two doors, proved by the compiler.
 *
 * `docs/architecture/imap-mutations.md` R3 says a placement is written only as
 * a conditional write. A rule like that is worth exactly as much as the thing
 * enforcing it, and a convention enforces nothing: the first four writers on
 * this branch each reached for the general-purpose `update()` and nobody
 * noticed, because nothing stopped them.
 *
 * So the placement fields are gone from every input type but the two that are
 * allowed to carry them — `transitionPlacement`, which takes a predicate, and
 * the settle in `updateUid`, which takes no input object at all and writes what
 * the mail server confirmed. Every `@ts-expect-error` below is a door that is
 * shut: delete the omission from `UpdateMessageInput` and these stop erroring,
 * which fails the build.
 *
 * `@ts-expect-error` is the assertion here, so this file is checked rather than
 * run. The one runtime case exists to keep the suite honest about having loaded
 * it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	PlacementPredicate,
	PlacementTransitionInput,
	UpdateMessageInput,
} from "./types.js";

// --- The general-purpose writer refuses every placement field ---------------

// @ts-expect-error `status` is a placement field: write it through a transition
const status: UpdateMessageInput = { status: "moving" };

// @ts-expect-error `syncStatus` is a placement field
const syncStatus: UpdateMessageInput = { syncStatus: "failed" };

// @ts-expect-error `abandonedMutation` is a placement field
const abandonedMutation: UpdateMessageInput = { abandonedMutation: "delete" };

// @ts-expect-error `mailboxId` is a placement field
const mailboxId: UpdateMessageInput = { mailboxId: "mbx-1" };

// @ts-expect-error `uid` is a placement field
const uid: UpdateMessageInput = { uid: 42 };

// @ts-expect-error `originalMailboxId` is a placement field
const originalMailboxId: UpdateMessageInput = { originalMailboxId: "mbx-1" };

// @ts-expect-error `originalUid` is a placement field
const originalUid: UpdateMessageInput = { originalUid: 42 };

// Everything else about a message still goes through it, unchanged.
const ordinary: UpdateMessageInput = {
	bodyStorageKey: "s3://body",
	category: "personal",
	spamReport: { reportedAt: 0 },
};

// --- The transition is the door, and it takes a predicate -------------------

const transition: {
	expected: PlacementPredicate;
	next: PlacementTransitionInput;
} = {
	expected: { status: ["moving", "deleting"], mailboxId: "mbx-1", uid: 42 },
	next: {
		status: "active",
		syncStatus: "abandoned",
		abandonedMutation: "delete",
		mailboxId: "mbx-1",
		uid: 42,
		originalMailboxId: null,
		originalUid: null,
	},
};

// The predicate names states, never a free-form column: a caller cannot smuggle
// an unrelated field into the WHERE clause and call it a lock.
// @ts-expect-error `category` is not part of a placement
const notAPlacement: PlacementPredicate = { category: "personal" };

test("the placement doors are the transition and the settle", () => {
	assert.equal(transition.next.status, "active");
	assert.equal(ordinary.category, "personal");
	assert.deepEqual(
		[
			status,
			syncStatus,
			abandonedMutation,
			mailboxId,
			uid,
			originalMailboxId,
			originalUid,
			notAPlacement,
		].length,
		8,
		"each of the seven fields, and the predicate's own shape, is pinned above",
	);
});
