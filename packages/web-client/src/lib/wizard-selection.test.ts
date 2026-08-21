import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThreadRowData } from "@remit/ui";
import { wizardSelectionFrom } from "./wizard-selection.js";

const row = (over: Partial<ThreadRowData> & { id: string }): ThreadRowData => ({
	fromName: "Alice",
	fromEmail: "alice@example.com",
	subject: "Quarterly report",
	snippet: "",
	timeLabel: "Jan 1",
	...over,
});

describe("the ticked rows the wizard is handed", () => {
	// Regression for #872: a bulk run batches per account, and a row that
	// arrives without its own account is one the run cannot place.
	it("carries each row's own account, not the first one it saw", () => {
		const got = wizardSelectionFrom(
			[
				row({ id: "m1", accountId: "acc-work" }),
				row({ id: "m2", accountId: "acc-personal" }),
			],
			new Set(["m1", "m2"]),
		);
		assert.deepEqual(
			got.map((message) => message.accountId),
			["acc-work", "acc-personal"],
		);
	});

	it("keeps a row whose list carries no account rather than dropping it", () => {
		const got = wizardSelectionFrom([row({ id: "m1" })], new Set(["m1"]));
		assert.deepEqual(
			got.map((message) => ({ id: message.id, accountId: message.accountId })),
			[{ id: "m1", accountId: undefined }],
		);
	});

	it("takes only the ticked rows", () => {
		const got = wizardSelectionFrom(
			[row({ id: "m1" }), row({ id: "m2" })],
			new Set(["m2"]),
		);
		assert.deepEqual(
			got.map((message) => message.id),
			["m2"],
		);
	});
});
