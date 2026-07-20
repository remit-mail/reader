/**
 * Regression (#47): the search query must not survive a move to another
 * mailbox. The /mail shell holds the field state and never unmounts between
 * child routes, so without these rules the text — and the query it drives —
 * followed the user from inbox to inbox.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type MailRouteMatch, mailViewKey } from "./mail-route.js";
import {
	committedSearchQuery,
	searchInputForView,
	shouldMirrorQuery,
} from "./search-view.js";

const matches = (routeId: string, mailboxId?: string): MailRouteMatch[] => [
	{ routeId: "__root__" },
	{ routeId: "/mail" },
	{ routeId, ...(mailboxId ? { params: { mailboxId } } : {}) },
];

describe("mailViewKey", () => {
	it("distinguishes two mailboxes", () => {
		assert.notEqual(
			mailViewKey(matches("/mail/$mailboxId", "inbox-1")),
			mailViewKey(matches("/mail/$mailboxId", "archive-1")),
		);
	});

	it("gives the same mailbox one key regardless of search params", () => {
		assert.equal(
			mailViewKey(matches("/mail/$mailboxId", "inbox-1")),
			mailViewKey(matches("/mail/$mailboxId", "inbox-1")),
		);
	});

	it("separates the brief, flagged and outbox views", () => {
		const keys = [
			mailViewKey(matches("/mail/")),
			mailViewKey(matches("/mail/flagged")),
			mailViewKey(matches("/mail/outbox")),
		];
		assert.equal(new Set(keys).size, 3);
	});
});

describe("searchInputForView", () => {
	it("clears the field when the destination carries no query", () => {
		assert.equal(
			searchInputForView(
				"/mail/$mailboxId:inbox-1",
				"/mail/$mailboxId:arch",
				"",
			),
			"",
		);
	});

	it("leaves the field alone while the view stays the same", () => {
		// Opening a result and the q-mirror both re-render on the same view; the
		// user's in-flight typing must survive both.
		assert.equal(
			searchInputForView(
				"/mail/$mailboxId:inbox-1",
				"/mail/$mailboxId:inbox-1",
				"",
			),
			undefined,
		);
	});

	it("seeds from the destination's own query (deep link, saved search)", () => {
		assert.equal(
			searchInputForView("/mail/$mailboxId:inbox-1", "/mail/", "invoice"),
			"invoice",
		);
	});
});

describe("committedSearchQuery", () => {
	it("commits an empty field immediately, without waiting on the debounce", () => {
		assert.equal(committedSearchQuery("", "stale query"), "");
	});

	it("debounces everything else", () => {
		assert.equal(committedSearchQuery("inv", ""), "");
		assert.equal(committedSearchQuery("invoice", "inv"), "inv");
	});
});

describe("shouldMirrorQuery", () => {
	it("writes a settled query the URL does not have yet", () => {
		assert.equal(shouldMirrorQuery("invoice", "invoice", ""), true);
	});

	it("stays quiet once the URL already says it", () => {
		assert.equal(shouldMirrorQuery("invoice", "invoice", "invoice"), false);
	});

	it("does not strip the query a deep link just arrived with", () => {
		// The field is seeded from the URL and the debounce has not caught up, so
		// the committed query is still the previous view's. Writing it would drop
		// `q` for the length of the debounce — and with it the search the link
		// asked for.
		assert.equal(shouldMirrorQuery("invoice", "", "invoice"), false);
	});

	it("waits for the debounce while the user is still typing", () => {
		assert.equal(shouldMirrorQuery("invoi", "inv", ""), false);
	});
});
