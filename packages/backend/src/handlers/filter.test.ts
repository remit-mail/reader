import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClientError, type FilterItem } from "@remit/remit-electrodb-service";
import {
	FilterMatchOperator,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import type { AnchorPayload } from "@remit/search-service";
import {
	createFilterWithAnchor,
	deriveFilterTtl,
	type FilterCrudDeps,
	pickFilterUpdate,
} from "./filter.js";

const filterItem = (over: Partial<FilterItem> = {}): FilterItem => ({
	filterId: "flt-1",
	accountConfigId: "cfg-1",
	name: "Booking confirmations",
	scope: FilterScope.Standing,
	state: FilterState.Active,
	hasAnchor: false,
	ruleChangedAt: 1_700_000_000,
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "None",
	createdAt: 1_700_000_000,
	updatedAt: 1_700_000_000,
	...over,
});

const ANCHOR: AnchorPayload = {
	anchorEmbedding: [0.1, 0.2, 0.3],
	anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
	anchorSourceText: "the anchor message preview",
};

interface Recorder {
	createInputs: unknown[];
	anchorPuts: unknown[];
	buildAnchorCalls: Array<[string, string]>;
}

const buildDeps = (
	recorder: Recorder,
	anchorResult: AnchorPayload | null = null,
): FilterCrudDeps => ({
	filter: {
		create: async (input) => {
			recorder.createInputs.push(input);
			return filterItem({
				accountConfigId: input.accountConfigId,
				name: input.name,
				scope: input.scope,
				expiresAt: input.expiresAt,
				ttl: input.ttl,
				hasAnchor: input.hasAnchor,
			});
		},
		get: async () => filterItem(),
		update: async (_a, _f, _i) => filterItem(),
		delete: async () => {},
		refreshExpiry: async (item) => item,
		listPageByAccountConfig: async () => ({
			items: [],
			continuationToken: undefined,
		}),
	},
	filterAnchor: {
		put: async (input) => {
			recorder.anchorPuts.push(input);
			return input;
		},
	},
	buildAnchor: async (accountConfigId, anchorMessageId) => {
		recorder.buildAnchorCalls.push([accountConfigId, anchorMessageId]);
		return anchorResult;
	},
});

const newRecorder = (): Recorder => ({
	createInputs: [],
	anchorPuts: [],
	buildAnchorCalls: [],
});

describe("deriveFilterTtl", () => {
	it("returns undefined for a Standing filter", () => {
		assert.equal(
			deriveFilterTtl(FilterScope.Standing, "2026-08-01T00:00:00+02:00"),
			undefined,
		);
	});

	it("returns undefined for a Temporary filter with no expiresAt", () => {
		assert.equal(deriveFilterTtl(FilterScope.Temporary, undefined), undefined);
	});

	it("derives epoch seconds from a Temporary filter's expiresAt", () => {
		const expiresAt = "2026-08-01T00:00:00+02:00";
		assert.equal(
			deriveFilterTtl(FilterScope.Temporary, expiresAt),
			Math.floor(new Date(expiresAt).getTime() / 1000),
		);
	});

	it("rejects an unparseable expiresAt", () => {
		assert.throws(
			() => deriveFilterTtl(FilterScope.Temporary, "not-a-date"),
			(err: unknown) => err instanceof ClientError,
		);
	});
});

describe("pickFilterUpdate", () => {
	it("keeps a name-only rename to just name (no predicate field)", () => {
		assert.deepEqual(pickFilterUpdate({ name: "Renamed" }), {
			name: "Renamed",
		});
	});

	it("keeps a predicate/action change", () => {
		assert.deepEqual(pickFilterUpdate({ actionMailboxId: "mbx-9" }), {
			actionMailboxId: "mbx-9",
		});
	});

	it("drops fields that are not client-updatable", () => {
		const body = {
			name: "Keep",
			state: "Expired",
			ruleChangedAt: 123,
			filterId: "smuggled",
		} as unknown as Parameters<typeof pickFilterUpdate>[0];
		assert.deepEqual(pickFilterUpdate(body), { name: "Keep" });
	});
});

describe("createFilterWithAnchor", () => {
	const baseInput = {
		name: "Booking confirmations",
		scope: FilterScope.Standing,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [],
		actionLabelId: "None",
		actionMailboxId: "None",
	};

	it("creates a purely-literal filter when no anchor message is given", async () => {
		const recorder = newRecorder();
		const filter = await createFilterWithAnchor(buildDeps(recorder), "cfg-1", {
			...baseInput,
		});

		assert.equal(recorder.buildAnchorCalls.length, 0);
		assert.equal(recorder.anchorPuts.length, 0);
		assert.equal(filter.hasAnchor, false);
	});

	it("persists the anchor row and flags hasAnchor when an anchor is built", async () => {
		const recorder = newRecorder();
		const filter = await createFilterWithAnchor(
			buildDeps(recorder, ANCHOR),
			"cfg-1",
			{ ...baseInput, anchorMessageId: "msg-7" },
		);

		assert.deepEqual(recorder.buildAnchorCalls, [["cfg-1", "msg-7"]]);
		assert.equal(filter.hasAnchor, true);
		assert.equal(recorder.anchorPuts.length, 1);
		assert.deepEqual(recorder.anchorPuts[0], {
			accountConfigId: "cfg-1",
			filterId: "flt-1",
			anchorMessageId: "msg-7",
			anchorEmbedding: ANCHOR.anchorEmbedding,
			anchorEmbeddingId: ANCHOR.anchorEmbeddingId,
			anchorSourceText: ANCHOR.anchorSourceText,
		});
	});

	it("stays purely literal when the anchor message has no indexed chunks", async () => {
		const recorder = newRecorder();
		const filter = await createFilterWithAnchor(
			buildDeps(recorder, null),
			"cfg-1",
			{ ...baseInput, anchorMessageId: "msg-empty" },
		);

		assert.equal(recorder.buildAnchorCalls.length, 1);
		assert.equal(recorder.anchorPuts.length, 0);
		assert.equal(filter.hasAnchor, false);
	});

	it("derives a Temporary filter's ttl from expiresAt", async () => {
		const recorder = newRecorder();
		const expiresAt = "2026-08-01T00:00:00+02:00";
		await createFilterWithAnchor(buildDeps(recorder), "cfg-1", {
			...baseInput,
			scope: FilterScope.Temporary,
			expiresAt,
		});

		const created = recorder.createInputs[0] as { ttl?: number };
		assert.equal(created.ttl, Math.floor(new Date(expiresAt).getTime() / 1000));
	});
});
