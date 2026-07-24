import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type OrganizeStageInput,
	resolveOrganizeStage,
} from "./mobile-organize-flow";

const base: OrganizeStageInput = {
	entry: "select-similar",
	hasSeed: true,
	previewStatus: "idle",
	matchedCount: undefined,
};

describe("resolveOrganizeStage — the guided mobile flow's state machine", () => {
	it("select-similar shows the widening state before the preview resolves", () => {
		assert.deepEqual(resolveOrganizeStage({ ...base, previewStatus: "idle" }), {
			kind: "widening",
		});
		assert.deepEqual(
			resolveOrganizeStage({ ...base, previewStatus: "pending" }),
			{ kind: "widening" },
		);
	});

	it("opens the organize sentence on the widened set once the preview matches", () => {
		assert.deepEqual(
			resolveOrganizeStage({
				...base,
				previewStatus: "success",
				matchedCount: 47,
			}),
			{ kind: "organize", matchedCount: 47, fallback: false },
		);
	});

	it("falls back to organizing the selection when the widen matches nothing — no dead end", () => {
		assert.deepEqual(
			resolveOrganizeStage({
				...base,
				previewStatus: "success",
				matchedCount: 0,
			}),
			{ kind: "organize", matchedCount: 0, fallback: true },
		);
		// A success with an undefined count is treated as zero, not a crash.
		assert.deepEqual(
			resolveOrganizeStage({
				...base,
				previewStatus: "success",
				matchedCount: undefined,
			}),
			{ kind: "organize", matchedCount: 0, fallback: true },
		);
	});

	it("surfaces the error branch when the widen fails", () => {
		assert.deepEqual(
			resolveOrganizeStage({ ...base, previewStatus: "error" }),
			{ kind: "error" },
		);
	});

	it("something-else shows the shortcuts + input until a seed is chosen", () => {
		assert.deepEqual(
			resolveOrganizeStage({
				entry: "something-else",
				hasSeed: false,
				previewStatus: "success",
				matchedCount: 47,
			}),
			{ kind: "something-else" },
		);
	});

	it("something-else widens after the seed, then opens the seeded sentence", () => {
		assert.deepEqual(
			resolveOrganizeStage({
				entry: "something-else",
				hasSeed: true,
				previewStatus: "pending",
				matchedCount: undefined,
			}),
			{ kind: "widening" },
		);
		assert.deepEqual(
			resolveOrganizeStage({
				entry: "something-else",
				hasSeed: true,
				previewStatus: "success",
				matchedCount: 12,
			}),
			{ kind: "organize", matchedCount: 12, fallback: false },
		);
	});
});
