import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UpdateFilterInput } from "@remit/data-ports";
import { FilterScope, FilterState } from "@remit/domain-enums";
import {
	pickFilterUpdate,
	rejectAnchorMutation,
	resolveFilterScopeExpiry,
} from "./filter.js";

describe("pickFilterUpdate", () => {
	it("carries scope and expiresAt through, alongside the predicate/action fields", () => {
		const patch = pickFilterUpdate({
			scope: FilterScope.Temporary,
			expiresAt: "2027-01-01T00:00:00+00:00",
			matchOperator: "Or",
		});
		assert.equal(patch.scope, FilterScope.Temporary);
		assert.equal(patch.expiresAt, "2027-01-01T00:00:00+00:00");
		assert.equal(patch.matchOperator, "Or");
	});

	it("leaves scope/expiresAt absent when the body doesn't touch them", () => {
		const patch = pickFilterUpdate({ name: "Receipts" });
		assert.equal("scope" in patch, false);
		assert.equal("expiresAt" in patch, false);
	});

	it("drops any server-derived field smuggled into the body", () => {
		const raw: Record<string, unknown> = {
			name: "Receipts",
			ttl: 123,
			state: "Expired",
			hasAnchor: true,
			ruleChangedAt: 999,
			filterId: "sneaky",
		};
		const patch = pickFilterUpdate(raw as Partial<UpdateFilterInput>);
		assert.deepEqual(patch, { name: "Receipts" });
	});
});

describe("rejectAnchorMutation", () => {
	it("throws a 400 when the body carries anchorMessageId", () => {
		assert.throws(
			() => rejectAnchorMutation({ anchorMessageId: "msg-1" }),
			(error: unknown) => {
				assert.equal((error as { statusCode?: number }).statusCode, 400);
				assert.match(
					(error as Error).message,
					/anchor can't change after creation/,
				);
				return true;
			},
		);
	});

	it("does not throw for an ordinary predicate/action/scope patch", () => {
		assert.doesNotThrow(() =>
			rejectAnchorMutation({
				name: "Receipts",
				scope: "Temporary",
				expiresAt: "2027-01-01T00:00:00+00:00",
			}),
		);
	});
});

describe("resolveFilterScopeExpiry (reader #266)", () => {
	it("moves Standing to Temporary given a future expiresAt", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Standing, expiresAt: undefined },
			{ scope: FilterScope.Temporary, expiresAt: "2099-01-01T00:00:00+00:00" },
		);
		assert.equal(resolved.scope, FilterScope.Temporary);
		assert.equal(resolved.expiresAt, "2099-01-01T00:00:00+00:00");
		assert.equal(resolved.state, FilterState.Active);
		assert.ok(resolved.ttl && resolved.ttl > 0);
	});

	it("rejects moving to Temporary without an expiresAt", () => {
		assert.throws(
			() =>
				resolveFilterScopeExpiry(
					{ scope: FilterScope.Standing, expiresAt: undefined },
					{ scope: FilterScope.Temporary },
				),
			(error: unknown) => {
				assert.equal((error as { statusCode?: number }).statusCode, 400);
				assert.match((error as Error).message, /needs expiresAt/);
				return true;
			},
		);
	});

	it("rejects an expiresAt patch that isn't paired with a Temporary scope", () => {
		assert.throws(
			() =>
				resolveFilterScopeExpiry(
					{ scope: FilterScope.Standing, expiresAt: undefined },
					{ expiresAt: "2099-01-01T00:00:00+00:00" },
				),
			(error: unknown) => {
				assert.equal((error as { statusCode?: number }).statusCode, 400);
				assert.match((error as Error).message, /only applies to a Temporary/);
				return true;
			},
		);
	});

	it("clears expiresAt/ttl and reports Active when moving Temporary to Standing", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Temporary, expiresAt: "2020-01-01T00:00:00+00:00" },
			{ scope: FilterScope.Standing },
		);
		assert.equal(resolved.scope, FilterScope.Standing);
		assert.equal(resolved.expiresAt, undefined);
		assert.equal(resolved.ttl, undefined);
		assert.equal(resolved.state, FilterState.Active);
	});

	it("recomputes ttl for an expiresAt-only change on an already-Temporary filter", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Temporary, expiresAt: "2026-08-01T00:00:00+00:00" },
			{ expiresAt: "2099-06-01T00:00:00+00:00" },
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
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Temporary, expiresAt: "2020-01-01T00:00:00+00:00" },
			{ expiresAt: "2099-01-01T00:00:00+00:00" },
		);
		assert.equal(resolved.state, FilterState.Active);
	});

	it("reads Expired immediately when the new expiresAt is already in the past", () => {
		const resolved = resolveFilterScopeExpiry(
			{ scope: FilterScope.Temporary, expiresAt: "2099-01-01T00:00:00+00:00" },
			{ expiresAt: "2020-01-01T00:00:00+00:00" },
		);
		assert.equal(resolved.state, FilterState.Expired);
	});

	it("rejects an unparseable expiresAt", () => {
		assert.throws(
			() =>
				resolveFilterScopeExpiry(
					{ scope: FilterScope.Standing, expiresAt: undefined },
					{ scope: FilterScope.Temporary, expiresAt: "not-a-date" },
				),
			(error: unknown) => {
				assert.equal((error as { statusCode?: number }).statusCode, 400);
				return true;
			},
		);
	});
});
