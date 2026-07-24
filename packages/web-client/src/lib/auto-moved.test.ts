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

const classifierMove = (
	action: RemitImapAutoMovedInfo["action"],
	fromPlacement: string,
): RemitImapAutoMovedInfo => ({ action, fromPlacement });

const filterMove = (
	fromMailboxId: string,
	destinationMailboxId: string,
): RemitImapAutoMovedInfo => ({
	fromMailboxId,
	destinationMailboxId,
	filterId: "flt-1",
});

describe("autoMovedLabel", () => {
	test("classifier move reads 'Moved from Junk by Remit'", () => {
		assert.equal(
			autoMovedLabel(classifierMove(PlacementAction.MoveToInbox, "junk")),
			"Moved from Junk by Remit",
		);
	});

	test("classifier move reads 'Moved from Inbox by Remit'", () => {
		assert.equal(
			autoMovedLabel(classifierMove(PlacementAction.MoveToJunk, "inbox")),
			"Moved from Inbox by Remit",
		);
	});

	test("classifier move falls back to plain language for an unrecognized placement", () => {
		assert.equal(
			autoMovedLabel(classifierMove(PlacementAction.MoveToInbox, "other")),
			"Moved from another folder by Remit",
		);
	});

	test("filter move names the resolved source folder", () => {
		assert.equal(
			autoMovedLabel(filterMove("mb-inbox", "mb-travel"), "Travel"),
			"Moved from Travel by Remit",
		);
	});

	test("filter move falls back to 'another folder' before the name resolves", () => {
		assert.equal(
			autoMovedLabel(filterMove("mb-inbox", "mb-travel")),
			"Moved from another folder by Remit",
		);
	});

	test("never leaks verdict jargon", () => {
		const cases = [
			classifierMove(PlacementAction.MoveToInbox, "junk"),
			classifierMove(PlacementAction.MoveToJunk, "inbox"),
			filterMove("mb-inbox", "mb-travel"),
		];
		for (const autoMoved of cases) {
			assert.doesNotMatch(
				autoMovedLabel(autoMoved),
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
		assert.equal(
			isAutoMoveInEffect(
				classifierMove(PlacementAction.MoveToInbox, "junk"),
				undefined,
				ROLE_MAILBOXES,
			),
			false,
		);
	});

	test("classifier: true when a MoveToInbox message sits in the Inbox mailbox", () => {
		assert.equal(
			isAutoMoveInEffect(
				classifierMove(PlacementAction.MoveToInbox, "junk"),
				"mb-inbox",
				ROLE_MAILBOXES,
			),
			true,
		);
	});

	test("classifier: true when a MoveToJunk message sits in the Junk mailbox", () => {
		assert.equal(
			isAutoMoveInEffect(
				classifierMove(PlacementAction.MoveToJunk, "inbox"),
				"mb-junk",
				ROLE_MAILBOXES,
			),
			true,
		);
	});

	test("classifier: false once the message has moved elsewhere", () => {
		const autoMoved = classifierMove(PlacementAction.MoveToInbox, "junk");
		assert.equal(
			isAutoMoveInEffect(autoMoved, "mb-archive", ROLE_MAILBOXES),
			false,
		);
		assert.equal(
			isAutoMoveInEffect(autoMoved, "mb-junk", ROLE_MAILBOXES),
			false,
		);
	});

	test("filter: true while the message sits in the filter's destination", () => {
		assert.equal(
			isAutoMoveInEffect(
				filterMove("mb-inbox", "mb-travel"),
				"mb-travel",
				ROLE_MAILBOXES,
			),
			true,
		);
	});

	test("filter: false once undone back to the source folder", () => {
		assert.equal(
			isAutoMoveInEffect(
				filterMove("mb-inbox", "mb-travel"),
				"mb-inbox",
				ROLE_MAILBOXES,
			),
			false,
		);
	});

	test("filter: in-effect does not depend on the Inbox/Junk role mailboxes", () => {
		assert.equal(
			isAutoMoveInEffect(filterMove("mb-inbox", "mb-travel"), "mb-travel", {
				inboxMailboxId: undefined,
				junkMailboxId: undefined,
			}),
			true,
		);
	});

	test("classifier: false when the implied destination mailbox hasn't resolved yet", () => {
		assert.equal(
			isAutoMoveInEffect(
				classifierMove(PlacementAction.MoveToInbox, "junk"),
				"mb-inbox",
				{ inboxMailboxId: undefined, junkMailboxId: "mb-junk" },
			),
			false,
		);
	});
});

describe("resolveUndoTargetMailboxId", () => {
	test("classifier: resolves the Junk mailbox for fromPlacement='junk'", () => {
		assert.equal(
			resolveUndoTargetMailboxId(
				classifierMove(PlacementAction.MoveToInbox, "junk"),
				ROLE_MAILBOXES,
			),
			"mb-junk",
		);
	});

	test("classifier: resolves the Inbox mailbox for fromPlacement='inbox'", () => {
		assert.equal(
			resolveUndoTargetMailboxId(
				classifierMove(PlacementAction.MoveToJunk, "inbox"),
				ROLE_MAILBOXES,
			),
			"mb-inbox",
		);
	});

	test("classifier: undefined when the role mailbox hasn't resolved yet", () => {
		assert.equal(
			resolveUndoTargetMailboxId(
				classifierMove(PlacementAction.MoveToInbox, "junk"),
				{ inboxMailboxId: "mb-inbox", junkMailboxId: undefined },
			),
			undefined,
		);
	});

	test("filter: undo targets the recorded source mailbox verbatim", () => {
		assert.equal(
			resolveUndoTargetMailboxId(
				filterMove("mb-work", "mb-travel"),
				ROLE_MAILBOXES,
			),
			"mb-work",
		);
	});

	test("undefined when autoMoved is absent", () => {
		assert.equal(
			resolveUndoTargetMailboxId(undefined, ROLE_MAILBOXES),
			undefined,
		);
	});
});
