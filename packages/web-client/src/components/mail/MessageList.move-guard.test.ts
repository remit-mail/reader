import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeThreadMessage } from "@/test-support/fixtures";
import { resolveMoveDisabledHint } from "./MessageList";

/**
 * Regression for #456: every account of one user shares an `accountConfigId`,
 * so a guard built from it can never trip. These rows share one and differ
 * only in `accountId`, which is the fact Move is scoped by.
 */
const work = makeThreadMessage({ messageId: "m1", accountId: "acc-work" });
const personal = makeThreadMessage({
	messageId: "m2",
	accountId: "acc-personal",
});
const alsoWork = makeThreadMessage({ messageId: "m3", accountId: "acc-work" });

describe("the move guard over a thread-list selection", () => {
	it("withholds Move from rows owned by different accounts", () => {
		assert.match(
			resolveMoveDisabledHint([work, personal], new Set(["m1", "m2"])) ?? "",
			/only works within one account/,
		);
	});

	it("offers Move to rows owned by the same account", () => {
		assert.equal(
			resolveMoveDisabledHint([work, alsoWork], new Set(["m1", "m3"])),
			undefined,
		);
	});

	it("ignores rows the selection does not hold", () => {
		assert.equal(
			resolveMoveDisabledHint([work, personal], new Set(["m1"])),
			undefined,
		);
	});

	it("offers Move when the list carries no account of its own", () => {
		const rows = [
			makeThreadMessage({ messageId: "m1", accountId: undefined }),
			makeThreadMessage({ messageId: "m2", accountId: undefined }),
		];
		assert.equal(
			resolveMoveDisabledHint(rows, new Set(["m1", "m2"])),
			undefined,
		);
	});
});
