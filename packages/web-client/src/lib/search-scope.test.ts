import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type BrowsedList,
	MAIL_BRIEF_ROUTE_ID,
	MAIL_FLAGGED_ROUTE_ID,
	MAIL_MAILBOX_ROUTE_ID,
	MAIL_OUTBOX_ROUTE_ID,
} from "./mail-route";
import {
	isScopedRoute,
	resultsScopeForRoute,
	SEARCH_SCOPE_CHIP_ID,
	scopeLabelForMailboxName,
	searchScopeForRoute,
} from "./search-scope";

const listFor: Record<string, BrowsedList["list"]> = {
	[MAIL_BRIEF_ROUTE_ID]: "brief",
	[MAIL_FLAGGED_ROUTE_ID]: "flagged",
	[MAIL_OUTBOX_ROUTE_ID]: "outbox",
	[MAIL_MAILBOX_ROUTE_ID]: "mailbox",
};

const browsing = (routeId: string): BrowsedList => ({
	list: listFor[routeId],
	mailboxId: undefined,
});

describe("searchScopeForRoute", () => {
	it("gives the daily brief no scope — it is the global view", () => {
		assert.deepEqual(searchScopeForRoute(browsing(MAIL_BRIEF_ROUTE_ID)), {
			kind: "global",
		});
	});

	it("scopes a mailbox route to its sidebar label", () => {
		assert.deepEqual(
			searchScopeForRoute(browsing(MAIL_MAILBOX_ROUTE_ID), "Spam"),
			{
				kind: "scoped",
				chip: { id: SEARCH_SCOPE_CHIP_ID, label: "in:spam" },
			},
		);
	});

	it("is pending, not global, while the mailbox name resolves", () => {
		// The list under the bar is already one mailbox. A chip reading a raw
		// uuid is worse than no chip, but the field must not claim to search
		// everything either.
		assert.deepEqual(
			searchScopeForRoute(browsing(MAIL_MAILBOX_ROUTE_ID), null),
			{ kind: "pending" },
		);
	});

	it("scopes the starred view", () => {
		const scope = searchScopeForRoute(browsing(MAIL_FLAGGED_ROUTE_ID));
		assert.equal(scope.kind === "scoped" && scope.chip.label, "is:starred");
	});

	it("scopes the outbox", () => {
		const scope = searchScopeForRoute(browsing(MAIL_OUTBOX_ROUTE_ID));
		assert.equal(scope.kind === "scoped" && scope.chip.label, "in:outbox");
	});

	it("prefers the virtual views over a lingering mailbox name", () => {
		const scope = searchScopeForRoute(browsing(MAIL_OUTBOX_ROUTE_ID), "Spam");
		assert.equal(scope.kind === "scoped" && scope.chip.label, "in:outbox");
	});
});

describe("isScopedRoute", () => {
	// This predicate decides whether a typed `in:` is recognized at all, so
	// every route has to answer it the same way it answers for its chip: a
	// route showing a scope chip must not also honour a competing typed term.
	for (const routeId of [
		MAIL_MAILBOX_ROUTE_ID,
		MAIL_FLAGGED_ROUTE_ID,
		MAIL_OUTBOX_ROUTE_ID,
	]) {
		it(`${routeId} carries a scope`, () => {
			assert.equal(isScopedRoute(browsing(routeId)), true);
		});
	}

	it("the daily brief carries none", () => {
		assert.equal(isScopedRoute(browsing(MAIL_BRIEF_ROUTE_ID)), false);
	});

	it("agrees with the chip on every route", () => {
		for (const routeId of [
			MAIL_BRIEF_ROUTE_ID,
			MAIL_MAILBOX_ROUTE_ID,
			MAIL_FLAGGED_ROUTE_ID,
			MAIL_OUTBOX_ROUTE_ID,
		]) {
			const scope = searchScopeForRoute(browsing(routeId), "Spam");
			assert.equal(
				isScopedRoute(browsing(routeId)),
				scope.kind === "scoped",
				`${routeId} disagrees about whether it has a scope`,
			);
		}
	});
});

describe("scopeLabelForMailboxName", () => {
	it("lower-cases so the chip reads like the operator it mimics", () => {
		assert.equal(scopeLabelForMailboxName("Archive"), "in:archive");
	});

	it("quotes a multi-word folder so the chip stays one term", () => {
		assert.equal(scopeLabelForMailboxName("Work  Stuff"), 'in:"work stuff"');
	});
});

// The invariant: no chip means global, a chip means every engine on that route
// respects it.
describe("resultsScopeForRoute", () => {
	it("passes the global search through as global", () => {
		assert.deepEqual(
			resultsScopeForRoute(browsing(MAIL_BRIEF_ROUTE_ID), { kind: "global" }),
			{
				kind: "global",
			},
		);
	});

	it("treats a mailbox whose name has not loaded as a folder, not global", () => {
		assert.deepEqual(
			resultsScopeForRoute(browsing(MAIL_MAILBOX_ROUTE_ID), {
				kind: "pending",
			}),
			{
				kind: "folder",
			},
		);
	});

	it("carries the mailbox's role so a Spam search shows its rows", () => {
		assert.deepEqual(
			resultsScopeForRoute(
				browsing(MAIL_MAILBOX_ROUTE_ID),
				{
					kind: "scoped",
					chip: { id: SEARCH_SCOPE_CHIP_ID, label: "in:spam" },
				},
				"junk",
			),
			{ kind: "folder", role: "junk" },
		);
	});

	it("calls starred a collection, so its spam is not dropped", () => {
		assert.deepEqual(
			resultsScopeForRoute(browsing(MAIL_FLAGGED_ROUTE_ID), {
				kind: "scoped",
				chip: { id: SEARCH_SCOPE_CHIP_ID, label: "is:starred" },
			}),
			{ kind: "collection" },
		);
	});

	it("keeps the outbox a folder — it is one queue, and never holds spam", () => {
		assert.deepEqual(
			resultsScopeForRoute(browsing(MAIL_OUTBOX_ROUTE_ID), {
				kind: "scoped",
				chip: { id: SEARCH_SCOPE_CHIP_ID, label: "in:outbox" },
			}),
			{ kind: "folder" },
		);
	});
});
