import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wrapHttpFailure } from "@/lib/api";
import {
	isFolderRoleRefusal,
	isMailboxNotSettledRefusal,
} from "./folder-role-refusal.js";

const wireBody = {
	code: "folder_role_unresolved",
	message: "No folder is appointed as Trash",
	details: { role: "Trash", reason: "none", accountId: "acct-1" },
};

// Every call site takes the error interceptor, so what reaches these readers is
// always the `ApiError` `wrapHttpFailure` builds — never the flat wire body it
// carries at `.body` (#1004).
const refused = (body: Record<string, unknown> = wireBody) =>
	wrapHttpFailure(body, 409);

describe("isFolderRoleRefusal", () => {
	it("carries the account and the reason the prompt needs", () => {
		assert.deepEqual(isFolderRoleRefusal(refused()), {
			reason: "none",
			role: "Trash",
			accountId: "acct-1",
		});
	});

	it("reads every reason the API declares", () => {
		for (const reason of ["none", "stale", "unconfirmed"]) {
			assert.equal(
				isFolderRoleRefusal(
					refused({ ...wireBody, details: { ...wireBody.details, reason } }),
				)?.reason,
				reason,
			);
		}
	});

	it("does not open the prompt for a 409 without the code", () => {
		assert.equal(
			isFolderRoleRefusal(
				refused({
					message: "No folder is appointed as Trash",
					details: wireBody.details,
				}),
			),
			undefined,
		);
		assert.equal(
			isFolderRoleRefusal(
				refused({ ...wireBody, code: "mailbox_not_settled" }),
			),
			undefined,
		);
	});

	it("never guesses at a message string", () => {
		assert.equal(
			isFolderRoleRefusal(new Error("folder_role_unresolved: Trash")),
			undefined,
		);
		assert.equal(
			isFolderRoleRefusal(
				wrapHttpFailure({ message: "folder_role_unresolved" }, 409),
			),
			undefined,
		);
	});

	it("refuses a body missing anything the prompt has to have", () => {
		assert.equal(
			isFolderRoleRefusal(refused({ ...wireBody, details: {} })),
			undefined,
		);
		assert.equal(
			isFolderRoleRefusal(
				refused({
					...wireBody,
					details: { role: "Trash", reason: "sideways", accountId: "acct-1" },
				}),
			),
			undefined,
		);
		assert.equal(
			isFolderRoleRefusal(
				refused({ ...wireBody, details: { role: "Trash", reason: "none" } }),
			),
			undefined,
		);
	});

	it("survives anything a network layer might throw", () => {
		for (const value of [undefined, null, "boom", 409, []]) {
			assert.equal(isFolderRoleRefusal(value), undefined);
		}
		assert.equal(
			isFolderRoleRefusal(wrapHttpFailure(undefined, 500)),
			undefined,
		);
	});

	it("still reads a bare wire body", () => {
		assert.equal(isFolderRoleRefusal(wireBody)?.accountId, "acct-1");
	});
});

describe("isMailboxNotSettledRefusal", () => {
	it("matches only the appointment write's own refusal", () => {
		assert.equal(
			isMailboxNotSettledRefusal(
				refused({
					code: "mailbox_not_settled",
					message: "Mailbox is still being created",
					details: { mailboxId: "mbx-1", syncStatus: "pending" },
				}),
			),
			true,
		);
		assert.equal(isMailboxNotSettledRefusal(refused()), false);
		assert.equal(isMailboxNotSettledRefusal(new Error("pending")), false);
	});
});
