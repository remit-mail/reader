import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type {
	CreateFilterInput,
	UpdateFilterInput as UpdateFilterRequestBody,
} from "@remit/api-openapi-types";
import type {
	CreateFilterAnchorInput,
	CreateFilterInput as FilterAnchorTxCreateInput,
	FilterItem,
} from "@remit/data-ports";
import {
	FilterMatchOperator,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import type { AnchorPayload } from "@remit/search-service";
import {
	createFilterWithAnchor,
	type FilterCrudDeps,
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
		const patch = pickFilterUpdate(raw as Partial<UpdateFilterRequestBody>);
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

describe("createFilterWithAnchor (#351)", () => {
	const ACCOUNT_CONFIG_ID = "acct-1";

	const baseInput: CreateFilterInput = {
		name: "Booking confirmations",
		scope: FilterScope.Standing,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [],
		actionLabelId: "None",
		actionMailboxId: "None",
	};

	const baseFilter: FilterItem = {
		filterId: "filter-1",
		accountConfigId: ACCOUNT_CONFIG_ID,
		name: baseInput.name,
		scope: FilterScope.Standing,
		state: FilterState.Active,
		hasAnchor: false,
		ruleChangedAt: 1_700_000_000,
		actionChangedAt: 1_700_000_000,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [],
		actionLabelId: "None",
		actionMailboxId: "None",
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
	};

	const anchorPayload: AnchorPayload = {
		anchorEmbedding: [0.1, 0.2, 0.3],
		anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
		anchorSourceText: "Your booking is confirmed",
	};

	type AnchorArg = Omit<CreateFilterAnchorInput, "filterId"> | null;
	const createWithAnchorMock = (
		impl: (
			filter: FilterAnchorTxCreateInput,
			anchor: AnchorArg,
		) => Promise<FilterItem>,
	) => mock.fn(impl);

	it("creates a purely-literal filter through one atomic call when there is no anchor message", async () => {
		const createWithAnchor = createWithAnchorMock(async () => baseFilter);
		const deps: FilterCrudDeps = {
			filterAnchorTransaction: { createWithAnchor },
			buildAnchor: mock.fn(async () => null),
		};

		const filter = await createFilterWithAnchor(
			deps,
			ACCOUNT_CONFIG_ID,
			baseInput,
		);

		assert.equal(filter, baseFilter);
		assert.equal(createWithAnchor.mock.calls.length, 1);
		const [filterArg, anchorArg] = createWithAnchor.mock.calls[0].arguments;
		assert.equal(filterArg.hasAnchor, false);
		assert.equal(anchorArg, null);
	});

	it("passes the built anchor and the new hasAnchor flag to the same atomic call", async () => {
		const createWithAnchor = createWithAnchorMock(async () => ({
			...baseFilter,
			hasAnchor: true,
		}));
		const buildAnchor = mock.fn(async () => anchorPayload);
		const deps: FilterCrudDeps = {
			filterAnchorTransaction: { createWithAnchor },
			buildAnchor,
		};
		const input: CreateFilterInput = {
			...baseInput,
			anchorMessageId: "msg-1",
		};

		const filter = await createFilterWithAnchor(deps, ACCOUNT_CONFIG_ID, input);

		assert.equal(filter.hasAnchor, true);
		assert.equal(buildAnchor.mock.calls.length, 1);
		assert.deepEqual(buildAnchor.mock.calls[0].arguments, [
			ACCOUNT_CONFIG_ID,
			"msg-1",
		]);

		assert.equal(createWithAnchor.mock.calls.length, 1);
		const [filterArg, anchorArg] = createWithAnchor.mock.calls[0].arguments;
		assert.equal(filterArg.hasAnchor, true);
		assert.deepEqual(anchorArg, {
			accountConfigId: ACCOUNT_CONFIG_ID,
			anchorMessageId: "msg-1",
			anchorEmbedding: anchorPayload.anchorEmbedding,
			anchorEmbeddingId: anchorPayload.anchorEmbeddingId,
			anchorSourceText: anchorPayload.anchorSourceText,
		});
	});

	it("creates a purely-literal filter when the anchor message has no indexed chunks", async () => {
		const createWithAnchor = createWithAnchorMock(async () => baseFilter);
		const deps: FilterCrudDeps = {
			filterAnchorTransaction: { createWithAnchor },
			buildAnchor: mock.fn(async () => null),
		};
		const input: CreateFilterInput = {
			...baseInput,
			anchorMessageId: "msg-with-no-chunks",
		};

		await createFilterWithAnchor(deps, ACCOUNT_CONFIG_ID, input);

		const [filterArg, anchorArg] = createWithAnchor.mock.calls[0].arguments;
		assert.equal(filterArg.hasAnchor, false);
		assert.equal(anchorArg, null);
	});

	it("propagates a failed atomic write as a failed create request, not a silent partial success", async () => {
		const createWithAnchor = createWithAnchorMock(async () => {
			throw new Error("anchor write failed");
		});
		const deps: FilterCrudDeps = {
			filterAnchorTransaction: { createWithAnchor },
			buildAnchor: mock.fn(async () => anchorPayload),
		};
		const input: CreateFilterInput = {
			...baseInput,
			anchorMessageId: "msg-1",
		};

		await assert.rejects(
			createFilterWithAnchor(deps, ACCOUNT_CONFIG_ID, input),
			/anchor write failed/,
		);
	});
});
