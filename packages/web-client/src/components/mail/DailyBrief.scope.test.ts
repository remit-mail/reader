import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThreadRowData } from "@remit/ui";
import { wizardScopeFor } from "@remit/ui";
import { resolveBriefSelectionScope } from "./DailyBrief";

/**
 * The brief spans accounts and folders, so it resolves both from the selection
 * itself. Which of the two a selection spans decides what the wizard's folder
 * and rule steps can say: told to pick a single account, a selection already
 * inside one account has nothing to act on and the flow dead-ends (#525).
 */

const row = (
	id: string,
	accountId: string,
	mailboxId: string,
): ThreadRowData => ({
	id,
	accountId,
	mailboxId,
	fromName: "Booking.com",
	fromEmail: "noreply@booking.com",
	subject: "Booking confirmation",
	snippet: "Your stay is confirmed",
	timeLabel: "Jul 2",
});

const rows: ThreadRowData[] = [
	row("m1", "acc-personal", "mbx-inbox"),
	row("m2", "acc-personal", "mbx-archive"),
	row("m3", "acc-work", "mbx-inbox"),
];

const scopeOf = (...ids: string[]) =>
	resolveBriefSelectionScope(rows, new Set(ids));

describe("the scope a brief selection resolves to", () => {
	it("carries the folder restriction when one account holds every row", () => {
		const scope = scopeOf("m1", "m2");
		assert.equal(scope.restriction, "spansFolders");
		assert.equal(scope.accountId, "acc-personal");
		assert.equal(scope.mailboxId, undefined);
		assert.match(scope.moveDisabledHint ?? "", /spans 2 folders/);
	});

	it("reaches the folder step told about folders, not accounts", () => {
		const scope = scopeOf("m1", "m2");
		const wizard = wizardScopeFor(scope.accountId, scope.restriction);
		assert.match(wizard.destination ?? "", /within one folder/);
		assert.doesNotMatch(wizard.destination ?? "", /account/);
		// The account is settled, so the preview behind a widened door has one to
		// count against and the match step keeps it.
		assert.equal(wizard.accountId, "acc-personal");
	});

	it("carries the account restriction when the rows span accounts", () => {
		const scope = scopeOf("m1", "m3");
		assert.equal(scope.restriction, "spansAccounts");
		assert.equal(scope.accountId, undefined);
		assert.match(
			wizardScopeFor(scope.accountId, scope.restriction).destination ?? "",
			/single account/,
		);
	});

	it("carries no restriction from one account and one folder", () => {
		const scope = scopeOf("m1");
		assert.equal(scope.restriction, undefined);
		assert.equal(scope.mailboxId, "mbx-inbox");
		assert.equal(
			wizardScopeFor(scope.accountId, scope.restriction).destination,
			undefined,
		);
	});
});
