/**
 * A filter made from a search belongs to the account the search ran over (#524).
 *
 * The surface hands its account to the host on the props; a search entry that
 * reaches past it writes the rule against whichever account happens to be first
 * in the list, and the mail the user was looking at is never filtered. Which
 * account wins between the query and the surface is
 * `../../lib/organize/search-to-rule.test.ts`; what is asserted here is the set
 * of props a search entry replaces, the account among them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchConversion } from "@remit/ui";
import { searchEntryOverrides } from "./SelectionWizardHost";

const conversion = (
	over: Partial<SearchConversion> = {},
): SearchConversion => ({
	clauses: [],
	matchOperator: "all",
	droppedFacets: [],
	keptTerms: false,
	droppedSemantic: false,
	...over,
});

const accounts = [{ accountId: "acc-first" }, { accountId: "acc-surface" }];

describe("the account a search entry writes its rule against", () => {
	it("is the one the surface handed over", () => {
		assert.equal(
			searchEntryOverrides(conversion(), { accountId: "acc-surface" }, accounts)
				.accountId,
			"acc-surface",
		);
	});

	it("is the one the query names when it names one", () => {
		assert.equal(
			searchEntryOverrides(
				conversion({ targetAccountId: "acc-typed" }),
				{ accountId: "acc-surface" },
				accounts,
			).accountId,
			"acc-typed",
		);
	});

	// The first configured account is the last resort, never the answer while the
	// surface has one of its own.
	it("falls back to the first configured account only when the surface has none", () => {
		assert.equal(
			searchEntryOverrides(conversion(), { accountId: undefined }, accounts)
				.accountId,
			"acc-first",
		);
	});
});

describe("what else a search entry replaces", () => {
	it("ticks nothing, carries no restriction and drops any escalation", () => {
		const overrides = searchEntryOverrides(
			conversion(),
			{ accountId: "acc-surface" },
			accounts,
		);
		assert.equal(overrides.verb, "organize");
		assert.deepEqual(overrides.selection, []);
		assert.equal(overrides.selectionRestriction, undefined);
		assert.equal(overrides.escalated, undefined);
	});

	it("hands the conversion on so the properties step can seed its clauses", () => {
		const seeded = conversion({ keptTerms: true });
		assert.equal(
			searchEntryOverrides(seeded, { accountId: "acc-surface" }, accounts)
				.searchConversion,
			seeded,
		);
	});
});
