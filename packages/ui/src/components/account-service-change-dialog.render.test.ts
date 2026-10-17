/**
 * The confirmation between a switch and the change it asks for (#1179). The
 * promise disabling makes — nothing is deleted, the stored rows stay — is a
 * sentence a person reads before they commit, so it is asserted here rather
 * than left to the copy of the day.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountServiceChangeCopy } from "./account-service-change-dialog.js";

describe("AccountServiceChangeDialog", () => {
	it("sends the last service off to removing the account", () => {
		const copy = accountServiceChangeCopy(
			{ kind: "last", service: "Mail" },
			"Microsoft",
		);
		assert.match(copy.title, /only thing this account syncs/);
		assert.match(copy.description, /An account has to sync something\./);
		assert.equal(copy.confirmLabel, "Remove account");
		assert.equal(copy.cancelLabel, "Keep syncing mail");
		assert.equal(copy.destructive, true);
	});

	it("keeps switching a service off away from the destructive style", () => {
		const copy = accountServiceChangeCopy(
			{ kind: "disable", service: "Mail" },
			"Microsoft",
		);
		assert.equal(copy.destructive, false);
		assert.equal(copy.confirmLabel, "Stop syncing mail");
	});
});
