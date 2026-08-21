import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isFolderRoleRefusal,
	isMailboxNotSettledRefusal,
} from "./folder-role-refusal.js";

const refusal = {
	code: "folder_role_unresolved",
	message: "No folder is appointed as Trash",
	details: { role: "Trash", reason: "none", accountId: "acct-1" },
};

describe("isFolderRoleRefusal", () => {
	it("carries the account and the reason the prompt needs", () => {
		assert.deepEqual(isFolderRoleRefusal(refusal), {
			reason: "none",
			role: "Trash",
			accountId: "acct-1",
		});
	});

	it("reads every reason the API declares", () => {
		for (const reason of ["none", "stale", "unconfirmed"]) {
			assert.equal(
				isFolderRoleRefusal({
					...refusal,
					details: { ...refusal.details, reason },
				})?.reason,
				reason,
			);
		}
	});

	it("does not open the prompt for a 409 without the code", () => {
		assert.equal(
			isFolderRoleRefusal({
				message: "No folder is appointed as Trash",
				details: refusal.details,
			}),
			undefined,
		);
		assert.equal(
			isFolderRoleRefusal({ ...refusal, code: "mailbox_not_settled" }),
			undefined,
		);
	});

	it("never guesses at a message string", () => {
		assert.equal(
			isFolderRoleRefusal(new Error("folder_role_unresolved: Trash")),
			undefined,
		);
	});

	it("refuses a body missing anything the prompt has to have", () => {
		assert.equal(isFolderRoleRefusal({ ...refusal, details: {} }), undefined);
		assert.equal(
			isFolderRoleRefusal({
				...refusal,
				details: { role: "Trash", reason: "sideways", accountId: "acct-1" },
			}),
			undefined,
		);
		assert.equal(
			isFolderRoleRefusal({
				...refusal,
				details: { role: "Trash", reason: "none" },
			}),
			undefined,
		);
	});

	it("survives anything a network layer might throw", () => {
		for (const value of [undefined, null, "boom", 409, []]) {
			assert.equal(isFolderRoleRefusal(value), undefined);
		}
	});
});

describe("isMailboxNotSettledRefusal", () => {
	it("matches only the appointment write's own refusal", () => {
		assert.equal(
			isMailboxNotSettledRefusal({
				code: "mailbox_not_settled",
				message: "Mailbox is still being created",
				details: { mailboxId: "mbx-1", syncStatus: "pending" },
			}),
			true,
		);
		assert.equal(isMailboxNotSettledRefusal(refusal), false);
		assert.equal(isMailboxNotSettledRefusal(new Error("pending")), false);
	});
});
