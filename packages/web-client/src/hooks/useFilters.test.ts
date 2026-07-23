/**
 * useFilters — the settings-page filter list read and the create/delete
 * invalidation contract.
 *
 * `useFilterList` is exercised the same way `useRescueCandidates` is: a
 * QueryClient is pre-seeded under the key the hook generates and the hook is
 * rendered synchronously via renderToString, so the queryFn never fires and
 * mapping drift breaks the assertions.
 *
 * Create and delete both invalidate `buildFilterListKey` on success; a drift
 * between that key and the one the list subscribes to would leave the settings
 * list stale after a filter is created or deleted, so the contract is pinned
 * directly against the generated SDK key (the pattern `buildMailboxListKey`
 * uses for trigger-sync).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { filterOperationsListFiltersQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { buildFilterListKey, useFilterList } from "./useFilters.js";

const ACCOUNT_ID = "acc-1";

const filter = (
	overrides: Partial<RemitImapFilterResponse> & { filterId: string },
): RemitImapFilterResponse =>
	({
		accountConfigId: "cfg-1",
		name: "Travel",
		scope: "Standing",
		state: "Active",
		hasAnchor: false,
		ruleChangedAt: 0,
		matchOperator: "And",
		literalClauses: [],
		actionLabelId: "None",
		actionMailboxId: "None",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as RemitImapFilterResponse;

function renderFilterList(
	accountId: string | undefined,
	seed?: RemitImapFilterResponse[],
): ReturnType<typeof useFilterList> {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	if (accountId && seed) {
		client.setQueryData(buildFilterListKey(accountId), { items: seed });
	}

	let captured = {} as ReturnType<typeof useFilterList>;
	function Capture() {
		captured = useFilterList(accountId);
		return null;
	}

	renderToString(
		createElement(
			QueryClientProvider,
			{ client },
			createElement(Capture),
		) as never,
	);

	return captured;
}

describe("buildFilterListKey", () => {
	test("matches the generated SDK key create/delete invalidate", () => {
		assert.deepEqual(
			buildFilterListKey(ACCOUNT_ID),
			filterOperationsListFiltersQueryKey({ path: { accountId: ACCOUNT_ID } }),
		);
	});

	test("is distinct per account, so one account's list is not invalidated by another's write", () => {
		assert.notDeepEqual(
			buildFilterListKey("acc-1"),
			buildFilterListKey("acc-2"),
		);
	});
});

describe("useFilterList", () => {
	test("returns the account's filters from the cache", () => {
		const { filters } = renderFilterList(ACCOUNT_ID, [
			filter({ filterId: "f1", name: "Travel" }),
			filter({ filterId: "f2", name: "Receipts", scope: "Temporary" }),
		]);
		assert.deepEqual(
			filters.map((f) => f.name),
			["Travel", "Receipts"],
		);
	});

	test("returns an empty list, not undefined, before any data lands", () => {
		const { filters } = renderFilterList(ACCOUNT_ID);
		assert.deepEqual(filters, []);
	});

	test("stays empty and disabled when no account is selected", () => {
		const { filters, isPending } = renderFilterList(undefined);
		assert.deepEqual(filters, []);
		// `enabled: false` keeps the query from fetching for an absent account.
		assert.equal(isPending, true);
	});
});
