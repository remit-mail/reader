import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAIL_BRIEF_ROUTE_ID,
	MAIL_FLAGGED_ROUTE_ID,
	MAIL_MAILBOX_ROUTE_ID,
	MAIL_OUTBOX_ROUTE_ID,
} from "./mail-route";
import {
	SEARCH_SCOPE_CHIP_ID,
	scopeLabelForMailboxName,
	searchScopeForRoute,
} from "./search-scope";

const matches = (routeId: string) => [{ routeId: "/mail" }, { routeId }];

describe("searchScopeForRoute", () => {
	it("gives the daily brief no scope — it is the global view", () => {
		assert.equal(searchScopeForRoute(matches(MAIL_BRIEF_ROUTE_ID)), undefined);
	});

	it("scopes a mailbox route to its sidebar label", () => {
		assert.deepEqual(
			searchScopeForRoute(matches(MAIL_MAILBOX_ROUTE_ID), "Spam"),
			{
				id: SEARCH_SCOPE_CHIP_ID,
				label: "in:spam",
			},
		);
	});

	it("shows no chip while the mailbox name is still resolving", () => {
		// A chip reading a raw uuid is worse than no chip.
		assert.equal(
			searchScopeForRoute(matches(MAIL_MAILBOX_ROUTE_ID), null),
			undefined,
		);
	});

	it("scopes the starred view", () => {
		assert.equal(
			searchScopeForRoute(matches(MAIL_FLAGGED_ROUTE_ID))?.label,
			"is:starred",
		);
	});

	it("scopes the outbox", () => {
		assert.equal(
			searchScopeForRoute(matches(MAIL_OUTBOX_ROUTE_ID))?.label,
			"in:outbox",
		);
	});

	it("prefers the virtual views over a lingering mailbox name", () => {
		assert.equal(
			searchScopeForRoute(matches(MAIL_OUTBOX_ROUTE_ID), "Spam")?.label,
			"in:outbox",
		);
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
