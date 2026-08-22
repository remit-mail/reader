import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeThreadMessage } from "@/test-support/fixtures";
import { resolveMoveDisabledHint } from "./MessageList";

/**
 * Regression for #456: every account of one user shares an `accountConfigId`,
 * so a guard built from it can never trip. These rows share one and differ only
 * in `accountId`, which is the fact Move is scoped by.
 */
const work = makeThreadMessage({ messageId: "m1", accountId: "acc-work" });
const personal = makeThreadMessage({
	messageId: "m2",
	accountId: "acc-personal",
});
const alsoWork = makeThreadMessage({ messageId: "m3", accountId: "acc-work" });
const unattributed = makeThreadMessage({
	messageId: "m4",
	accountId: undefined,
});

const hintFor = (
	threads: ReturnType<typeof makeThreadMessage>[],
	ids: string[],
	listAccountId?: string,
) => resolveMoveDisabledHint(threads, new Set(ids), listAccountId);

describe("the move guard over a thread-list selection", () => {
	it("withholds Move from rows owned by different accounts", () => {
		assert.match(
			hintFor([work, personal], ["m1", "m2"]) ?? "",
			/only works within one account/,
		);
	});

	it("offers Move to rows owned by the same account", () => {
		assert.equal(hintFor([work, alsoWork], ["m1", "m3"]), undefined);
	});

	it("ignores rows the selection does not hold", () => {
		assert.equal(hintFor([work, personal], ["m1"]), undefined);
	});

	// A per-mailbox list attaches no account to its rows, so the list's own
	// account stands in for them — otherwise the guard sees an empty set and
	// under-fires on a selection that really does span two accounts.
	it("withholds Move when a row without an account sits under another one", () => {
		assert.match(
			hintFor([unattributed, work], ["m4", "m1"], "acc-personal") ?? "",
			/only works within one account/,
		);
	});

	it("offers Move when the list's account is the one every row falls back to", () => {
		assert.equal(
			hintFor([unattributed, work], ["m4", "m1"], "acc-work"),
			undefined,
		);
	});

	it("offers Move when neither the rows nor the list name an account", () => {
		assert.equal(hintFor([unattributed], ["m4"], undefined), undefined);
	});
});
