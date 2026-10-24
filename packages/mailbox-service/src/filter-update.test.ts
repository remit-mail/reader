import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	FilterDisabledReason,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import { resolveFilterUpdate } from "./filter-operations.js";
import type { Refusable } from "./refusal.js";

const NOW = Date.parse("2026-09-25T12:00:00Z");

const standing = {
	scope: FilterScope.Standing,
	expiresAt: undefined,
	state: FilterState.Active,
	disabledReason: FilterDisabledReason.None,
	actionMailboxId: "mbx-invoices",
};

const awaiting = {
	...standing,
	state: FilterState.Disabled,
	disabledReason: FilterDisabledReason.AwaitingFolder,
	actionMailboxId: "None",
};

const valueOf = <T>(outcome: Refusable<T>): T => {
	if (!outcome.ok) assert.fail(`refused: ${outcome.refusal.message}`);
	return outcome.value;
};

const refusedWith = <T>(outcome: Refusable<T>, message: RegExp): void => {
	assert.equal(outcome.ok, false, "expected a refusal");
	if (outcome.ok) return;
	assert.equal(outcome.refusal.kind, "Invalid");
	assert.match(outcome.refusal.message, message);
};

describe("resolveFilterUpdate: state (#1103)", () => {
	it("records UserDisabled when the user turns a filter off", () => {
		assert.deepEqual(
			resolveFilterUpdate(standing, { state: FilterState.Disabled }, NOW),
			{
				ok: true,
				value: {
					state: FilterState.Disabled,
					disabledReason: FilterDisabledReason.UserDisabled,
				},
			},
		);
	});

	for (const reason of [
		FilterDisabledReason.UserDisabled,
		FilterDisabledReason.AwaitingFolder,
		FilterDisabledReason.FolderCreateFailed,
		FilterDisabledReason.FolderMissing,
	]) {
		it(`clears ${reason} when the user turns the filter back on`, () => {
			assert.deepEqual(
				resolveFilterUpdate(
					{ ...standing, state: FilterState.Disabled, disabledReason: reason },
					{ state: FilterState.Active },
					NOW,
				),
				{
					ok: true,
					value: {
						state: FilterState.Active,
						disabledReason: FilterDisabledReason.None,
					},
				},
			);
		});
	}

	it("keeps a disabled filter disabled, with its reason, through an expiry edit", () => {
		const resolved = valueOf(
			resolveFilterUpdate(
				{ ...standing, state: FilterState.Disabled },
				{
					scope: FilterScope.Temporary,
					expiresAt: "2027-01-01T00:00:00+00:00",
				},
				NOW,
			),
		);
		assert.equal(resolved.state, FilterState.Disabled);
		assert.equal("disabledReason" in resolved, false);
	});

	for (const reason of [
		FilterDisabledReason.AwaitingFolder,
		FilterDisabledReason.FolderCreateFailed,
	]) {
		it(`refuses to turn on a ${reason} filter that has no folder`, () => {
			refusedWith(
				resolveFilterUpdate(
					{ ...awaiting, disabledReason: reason },
					{ state: FilterState.Active },
					NOW,
				),
				/pick a folder in the rule/i,
			);
		});

		it(`turns on a ${reason} filter once the patch names a folder`, () => {
			const resolved = valueOf(
				resolveFilterUpdate(
					{ ...awaiting, disabledReason: reason },
					{ state: FilterState.Active, actionMailboxId: "mbx-picked" },
					NOW,
				),
			);
			assert.equal(resolved.state, FilterState.Active);
		});
	}

	it("keeps a folderless reason when the user turns an awaiting filter off again", () => {
		const resolved = valueOf(
			resolveFilterUpdate(awaiting, { state: FilterState.Disabled }, NOW),
		);
		assert.equal(resolved.state, FilterState.Disabled);
		assert.equal("disabledReason" in resolved, false);
		refusedWith(
			resolveFilterUpdate(awaiting, { state: FilterState.Active }, NOW),
			/pick a folder in the rule/i,
		);
	});

	it("keeps a lapsed folderless filter off when its date moves forward", () => {
		const lapsed = {
			...awaiting,
			scope: FilterScope.Temporary,
			expiresAt: "2026-01-01T00:00:00+00:00",
			disabledReason: FilterDisabledReason.FolderCreateFailed,
		};
		const resolved = valueOf(
			resolveFilterUpdate(
				lapsed,
				{
					scope: FilterScope.Temporary,
					expiresAt: "2027-01-01T00:00:00+00:00",
				},
				NOW,
			),
		);
		assert.equal(resolved.state, FilterState.Disabled);
		assert.equal("disabledReason" in resolved, false);
		refusedWith(
			resolveFilterUpdate(
				{ ...lapsed, expiresAt: "2027-01-01T00:00:00+00:00" },
				{ state: FilterState.Active },
				NOW,
			),
			/pick a folder in the rule/i,
		);
	});

	it("marks a folderless filter UserDisabled once the user picks a folder", () => {
		assert.deepEqual(
			resolveFilterUpdate(awaiting, { actionMailboxId: "mbx-picked" }, NOW),
			{
				ok: true,
				value: {
					actionMailboxId: "mbx-picked",
					disabledReason: FilterDisabledReason.UserDisabled,
				},
			},
		);
	});

	it("refuses Expired as a state the user sets", () => {
		refusedWith(
			resolveFilterUpdate(standing, { state: FilterState.Expired }, NOW),
			/expires through its date/,
		);
	});

	it("refuses to turn on a temporary filter whose date has passed", () => {
		refusedWith(
			resolveFilterUpdate(
				{
					...standing,
					scope: FilterScope.Temporary,
					expiresAt: "2026-01-01T00:00:00+00:00",
					state: FilterState.Disabled,
				},
				{ state: FilterState.Active },
				NOW,
			),
			/has expired/,
		);
	});

	it("leaves a patch that names neither state nor timing untouched", () => {
		assert.deepEqual(resolveFilterUpdate(standing, { name: "Receipts" }, NOW), {
			ok: true,
			value: { name: "Receipts" },
		});
	});
});

describe("resolveFilterUpdate: scope and expiry (reader #266)", () => {
	it("moves Standing to Temporary given a future expiresAt", () => {
		const resolved = valueOf(
			resolveFilterUpdate(standing, {
				scope: FilterScope.Temporary,
				expiresAt: "2099-01-01T00:00:00+00:00",
			}),
		);
		assert.equal(resolved.scope, FilterScope.Temporary);
		assert.equal(resolved.expiresAt, "2099-01-01T00:00:00+00:00");
		assert.equal(resolved.state, FilterState.Active);
		assert.ok(resolved.ttl && resolved.ttl > 0);
	});

	it("refuses moving to Temporary without an expiresAt", () => {
		refusedWith(
			resolveFilterUpdate(standing, { scope: FilterScope.Temporary }),
			/needs expiresAt/,
		);
	});

	it("refuses an expiresAt that isn't paired with a Temporary scope", () => {
		refusedWith(
			resolveFilterUpdate(standing, { expiresAt: "2099-01-01T00:00:00+00:00" }),
			/only applies to a Temporary/,
		);
	});

	it("clears expiresAt/ttl and reports Active when moving Temporary to Standing", () => {
		const resolved = valueOf(
			resolveFilterUpdate(
				{
					...standing,
					scope: FilterScope.Temporary,
					expiresAt: "2020-01-01T00:00:00+00:00",
					state: FilterState.Expired,
				},
				{ scope: FilterScope.Standing },
			),
		);
		assert.equal(resolved.scope, FilterScope.Standing);
		assert.equal(resolved.expiresAt, undefined);
		assert.equal(resolved.ttl, undefined);
		assert.equal(resolved.state, FilterState.Active);
	});

	it("recomputes ttl for an expiresAt-only change on an already-Temporary filter", () => {
		const resolved = valueOf(
			resolveFilterUpdate(
				{
					...standing,
					scope: FilterScope.Temporary,
					expiresAt: "2099-01-01T00:00:00+00:00",
				},
				{ expiresAt: "2099-06-01T00:00:00+00:00" },
			),
		);
		assert.equal(resolved.scope, FilterScope.Temporary);
		assert.equal(resolved.expiresAt, "2099-06-01T00:00:00+00:00");
		assert.equal(
			resolved.ttl,
			Math.floor(new Date("2099-06-01T00:00:00+00:00").getTime() / 1000),
		);
		assert.equal(resolved.state, FilterState.Active);
	});

	it("reactivates a lapsed filter extended into the future", () => {
		const resolved = valueOf(
			resolveFilterUpdate(
				{
					...standing,
					scope: FilterScope.Temporary,
					expiresAt: "2020-01-01T00:00:00+00:00",
					state: FilterState.Expired,
				},
				{ expiresAt: "2099-01-01T00:00:00+00:00" },
			),
		);
		assert.equal(resolved.state, FilterState.Active);
	});

	it("reads Expired immediately when the new expiresAt is already in the past", () => {
		const resolved = valueOf(
			resolveFilterUpdate(
				{
					...standing,
					scope: FilterScope.Temporary,
					expiresAt: "2099-01-01T00:00:00+00:00",
				},
				{ expiresAt: "2020-01-01T00:00:00+00:00" },
			),
		);
		assert.equal(resolved.state, FilterState.Expired);
	});

	it("rejects an unparseable expiresAt", () => {
		assert.throws(
			() =>
				resolveFilterUpdate(standing, {
					scope: FilterScope.Temporary,
					expiresAt: "not-a-date",
				}),
			(error: unknown) => {
				assert.equal((error as { statusCode?: number }).statusCode, 400);
				return true;
			},
		);
	});
});
