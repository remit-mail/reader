import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapAutoMovedInfo } from "@remit/api-http-client/types.gen.ts";
import { PlacementAction } from "@remit/domain-enums";
import {
	type AutoMovedRoleMailboxes,
	autoMovedLabel,
	isAutoMoveInEffect,
	resolveUndoTargetMailboxId,
} from "./auto-moved.js";

const ROLE_MAILBOXES: AutoMovedRoleMailboxes = {
	inboxMailboxId: "mb-inbox",
	junkMailboxId: "mb-junk",
};

describe("autoMovedLabel", () => {
	test("reads 'Moved from Junk by Remit'", () => {
		assert.equal(autoMovedLabel("junk"), "Moved from Junk by Remit");
	});

	test("reads 'Moved from Inbox by Remit'", () => {
		assert.equal(autoMovedLabel("inbox"), "Moved from Inbox by Remit");
	});

	test("falls back to plain language for an unrecognized placement", () => {
		assert.equal(autoMovedLabel("other"), "Moved from another folder by Remit");
	});

	test("never leaks verdict jargon", () => {
		for (const placement of ["inbox", "junk", "other"]) {
			assert.doesNotMatch(
				autoMovedLabel(placement),
				/confiden|dry.?run|verdict/i,
			);
		}
	});
});

describe("isAutoMoveInEffect", () => {
	test("false when autoMoved is absent", () => {
		assert.equal(
			isAutoMoveInEffect(undefined, "mb-inbox", ROLE_MAILBOXES),
			false,
		);
	});

	test("false when currentMailboxId is absent", () => {
		const autoMoved: RemitImapAutoMovedInfo = {
			action: PlacementAction.MoveToInbox,
			fromPlacement: "junk",
		};
		assert.equal(
			isAutoMoveInEffect(autoMoved, undefined, ROLE_MAILBOXES),
			false,
		);
	});

	test("true when a MoveToInbox message currently sits in the Inbox mailbox", () => {
		const autoMoved: RemitImapAutoMovedInfo = {
			action: PlacementAction.MoveToInbox,
			fromPlacement: "junk",
		};
		assert.equal(
			isAutoMoveInEffect(autoMoved, "mb-inbox", ROLE_MAILBOXES),
			true,
		);
	});

	test("true when a MoveToJunk message currently sits in the Junk mailbox", () => {
		const autoMoved: RemitImapAutoMovedInfo = {
			action: PlacementAction.MoveToJunk,
			fromPlacement: "inbox",
		};
		assert.equal(
			isAutoMoveInEffect(autoMoved, "mb-junk", ROLE_MAILBOXES),
			true,
		);
	});

	test("false once the message has moved elsewhere (self-hide on reconcile)", () => {
		const autoMoved: RemitImapAutoMovedInfo = {
			action: PlacementAction.MoveToInbox,
			fromPlacement: "junk",
		};
		assert.equal(
			isAutoMoveInEffect(autoMoved, "mb-archive", ROLE_MAILBOXES),
			false,
		);
		// Undone back to Junk — no longer in the implied destination.
		assert.equal(
			isAutoMoveInEffect(autoMoved, "mb-junk", ROLE_MAILBOXES),
			false,
		);
	});

	test("false when the implied destination mailbox hasn't resolved yet", () => {
		const autoMoved: RemitImapAutoMovedInfo = {
			action: PlacementAction.MoveToInbox,
			fromPlacement: "junk",
		};
		assert.equal(
			isAutoMoveInEffect(autoMoved, "mb-inbox", {
				inboxMailboxId: undefined,
				junkMailboxId: "mb-junk",
			}),
			false,
		);
	});
});

describe("resolveUndoTargetMailboxId", () => {
	test("resolves the Junk mailbox for fromPlacement='junk'", () => {
		assert.equal(resolveUndoTargetMailboxId("junk", ROLE_MAILBOXES), "mb-junk");
	});

	test("resolves the Inbox mailbox for fromPlacement='inbox'", () => {
		assert.equal(
			resolveUndoTargetMailboxId("inbox", ROLE_MAILBOXES),
			"mb-inbox",
		);
	});

	test("undefined for an unresolvable placement", () => {
		assert.equal(
			resolveUndoTargetMailboxId("other", ROLE_MAILBOXES),
			undefined,
		);
	});

	test("undefined when the role mailbox hasn't resolved yet", () => {
		assert.equal(
			resolveUndoTargetMailboxId("junk", {
				inboxMailboxId: "mb-inbox",
				junkMailboxId: undefined,
			}),
			undefined,
		);
	});
});
