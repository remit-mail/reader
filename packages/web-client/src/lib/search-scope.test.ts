import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAIL_BRIEF_ROUTE_ID,
	MAIL_FLAGGED_ROUTE_ID,
	MAIL_MAILBOX_ROUTE_ID,
	MAIL_OUTBOX_ROUTE_ID,
} from "./mail-route";
import {
	isScopedRoute,
	SEARCH_SCOPE_CHIP_ID,
	scopeLabelForMailboxName,
	searchScopeForRoute,
	semanticMailboxScope,
} from "./search-scope";

const matches = (routeId: string) => [{ routeId: "/mail" }, { routeId }];

describe("searchScopeForRoute", () => {
	it("gives the daily brief no scope — it is the global view", () => {
		assert.deepEqual(searchScopeForRoute(matches(MAIL_BRIEF_ROUTE_ID)), {
			kind: "global",
		});
	});

	it("scopes a mailbox route to its sidebar label", () => {
		assert.deepEqual(
			searchScopeForRoute(matches(MAIL_MAILBOX_ROUTE_ID), "Spam"),
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
			searchScopeForRoute(matches(MAIL_MAILBOX_ROUTE_ID), null),
			{ kind: "pending" },
		);
	});

	it("scopes the starred view", () => {
		const scope = searchScopeForRoute(matches(MAIL_FLAGGED_ROUTE_ID));
		assert.equal(scope.kind === "scoped" && scope.chip.label, "is:starred");
	});

	it("scopes the outbox", () => {
		const scope = searchScopeForRoute(matches(MAIL_OUTBOX_ROUTE_ID));
		assert.equal(scope.kind === "scoped" && scope.chip.label, "in:outbox");
	});

	it("prefers the virtual views over a lingering mailbox name", () => {
		const scope = searchScopeForRoute(matches(MAIL_OUTBOX_ROUTE_ID), "Spam");
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
			assert.equal(isScopedRoute(matches(routeId)), true);
		});
	}

	it("the daily brief carries none", () => {
		assert.equal(isScopedRoute(matches(MAIL_BRIEF_ROUTE_ID)), false);
	});

	it("agrees with the chip on every route", () => {
		for (const routeId of [
			MAIL_BRIEF_ROUTE_ID,
			MAIL_MAILBOX_ROUTE_ID,
			MAIL_FLAGGED_ROUTE_ID,
			MAIL_OUTBOX_ROUTE_ID,
		]) {
			const scope = searchScopeForRoute(matches(routeId), "Spam");
			assert.equal(
				isScopedRoute(matches(routeId)),
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
// respects it. The semantic engine used to run unscoped inside a mailbox under
// an "Everywhere" heading, contradicting the `in:` chip the same bar showed.
describe("semanticMailboxScope — a chip binds every engine on the route", () => {
	const mailbox = (mailboxId: string) => [
		{ routeId: "/mail" },
		{ routeId: MAIL_MAILBOX_ROUTE_ID, params: { mailboxId } },
	];

	it("pins a mailbox route to its own mailbox", () => {
		assert.equal(
			semanticMailboxScope({ matches: mailbox("mbx-spam") }),
			"mbx-spam",
		);
	});

	it("a mailbox route ignores a caller asking for somewhere else", () => {
		assert.equal(
			semanticMailboxScope({
				matches: mailbox("mbx-spam"),
				callerMailboxId: "mbx-archive",
			}),
			"mbx-spam",
		);
	});

	it("a mailbox route ignores a typed in: term", () => {
		assert.equal(
			semanticMailboxScope({
				matches: mailbox("mbx-spam"),
				inTokenMailboxId: "mbx-archive",
			}),
			"mbx-spam",
		);
	});

	it("a mailbox route never widens to global", () => {
		const scope = semanticMailboxScope({ matches: mailbox("mbx-spam") });
		assert.notEqual(scope, undefined, "a scoped route must carry a scope");
	});

	// Flagged and outbox are scoped to a collection, which the mailbox-scoped
	// semantic API cannot express — so neither runs a semantic section, and
	// neither may fall back to a typed `in:` under its own chip.
	for (const routeId of [MAIL_FLAGGED_ROUTE_ID, MAIL_OUTBOX_ROUTE_ID]) {
		it(`${routeId} never honours a typed in: term`, () => {
			assert.equal(
				semanticMailboxScope({
					matches: matches(routeId),
					inTokenMailboxId: "mbx-archive",
				}),
				undefined,
			);
		});
	}

	it("the daily brief is global — no route scope, no chip", () => {
		assert.equal(
			semanticMailboxScope({ matches: matches(MAIL_BRIEF_ROUTE_ID) }),
			undefined,
		);
	});

	it("the daily brief is the one route a typed in: narrows", () => {
		assert.equal(
			semanticMailboxScope({
				matches: matches(MAIL_BRIEF_ROUTE_ID),
				inTokenMailboxId: "mbx-archive",
			}),
			"mbx-archive",
		);
	});

	it("every scoped route resolves a scope or refuses to widen", () => {
		// Pins the invariant across the route table rather than one case at a
		// time: on a scoped route the resolved scope is either the route's own
		// mailbox, or nothing that came from the typed query.
		const scoped = [
			{ matches: mailbox("mbx-spam"), expected: "mbx-spam" },
			{ matches: matches(MAIL_FLAGGED_ROUTE_ID), expected: undefined },
			{ matches: matches(MAIL_OUTBOX_ROUTE_ID), expected: undefined },
		];
		for (const { matches: m, expected } of scoped) {
			assert.equal(isScopedRoute(m), true);
			assert.equal(
				semanticMailboxScope({ matches: m, inTokenMailboxId: "mbx-elsewhere" }),
				expected,
			);
		}
	});
});
