import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { showInlineSearchResults } from "./search-surface.js";

describe("showInlineSearchResults", () => {
	test("phone never swaps in the inline panel — it keeps its takeover", () => {
		assert.equal(
			showInlineSearchResults({
				tier: "phone",
				hasLiveInput: true,
				hasCommittedQuery: true,
				bodyRendersCommittedResults: false,
			}),
			false,
		);
	});

	test("no query means the normal list, on every tier", () => {
		assert.equal(
			showInlineSearchResults({
				tier: "desktop",
				hasLiveInput: false,
				hasCommittedQuery: false,
				bodyRendersCommittedResults: true,
			}),
			false,
		);
	});

	test("a view without its own results body keeps the panel for any query", () => {
		for (const hasCommittedQuery of [true, false]) {
			for (const tier of ["tablet", "desktop"] as const) {
				assert.equal(
					showInlineSearchResults({
						tier,
						hasLiveInput: true,
						hasCommittedQuery,
						bodyRendersCommittedResults: false,
					}),
					true,
					`${tier} committed=${hasCommittedQuery} should keep the panel`,
				);
			}
		}
	});

	test("the mailbox route shows the panel while typing an uncommitted query", () => {
		for (const tier of ["tablet", "desktop"] as const) {
			assert.equal(
				showInlineSearchResults({
					tier,
					hasLiveInput: true,
					hasCommittedQuery: false,
					bodyRendersCommittedResults: true,
				}),
				true,
			);
		}
	});

	test("the mailbox route hands back to its selectable body once the query commits", () => {
		for (const tier of ["tablet", "desktop"] as const) {
			assert.equal(
				showInlineSearchResults({
					tier,
					hasLiveInput: true,
					hasCommittedQuery: true,
					bodyRendersCommittedResults: true,
				}),
				false,
			);
		}
	});
});
