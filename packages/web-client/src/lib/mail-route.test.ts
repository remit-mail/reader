/**
 * Three contracts, each of which has already cost a regression.
 *
 * The list is read off a matched route id, never the parent /mail layout's
 * pathname: that pathname is "/mail" on every child route, and keying off it
 * routed every mailbox through the brief pane, so the message-row anchors
 * vanished.
 *
 * The view key of a list equals the view key of anything nested under it. A
 * thread is a child route of the list it was opened from, so a key that moved
 * when the thread opened would tell `lib/search-view.ts` the reader had left
 * the view — and the query they had just typed would be re-seeded from the URL
 * and disappear the moment they opened a hit.
 *
 * And "am I the current list" is answered by the pathname, not by the matches,
 * because the matches lag a navigation by as long as the destination takes to
 * mount.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	locationIsOnList,
	locationOpensDetail,
	MAIL_BRIEF_ROUTE_ID,
	MAIL_FLAGGED_ROUTE_ID,
	MAIL_MAILBOX_ROUTE_ID,
	MAIL_OUTBOX_ROUTE_ID,
	type MailRouteMatch,
	mailListRoute,
	mailViewKey,
} from "./mail-route.js";

/** Matches as TanStack Router reports them: outermost first, leaf last. */
const matches = (
	routeIds: readonly string[],
	params?: Record<string, string>,
): MailRouteMatch[] => [
	{ routeId: "__root__" },
	{ routeId: "/mail" },
	...routeIds.map((routeId) => ({ routeId, ...(params ? { params } : {}) })),
];

const brief = matches([MAIL_BRIEF_ROUTE_ID]);
const flagged = matches([MAIL_FLAGGED_ROUTE_ID]);
const outbox = matches([MAIL_OUTBOX_ROUTE_ID]);
const mailbox = matches([MAIL_MAILBOX_ROUTE_ID], { mailboxId: "inbox-1" });

describe("mailListRoute", () => {
	it("names each of the four lists", () => {
		assert.deepEqual(mailListRoute(brief), { list: "brief" });
		assert.deepEqual(mailListRoute(flagged), { list: "flagged" });
		assert.deepEqual(mailListRoute(outbox), { list: "outbox" });
		assert.deepEqual(mailListRoute(mailbox), {
			list: "mailbox",
			mailboxId: "inbox-1",
		});
		assert.deepEqual(mailListRoute(matches([MAIL_MAILBOX_ROUTE_ID])), {
			list: "mailbox",
			mailboxId: undefined,
		});
	});

	it("never reads the parent /mail layout as a list", () => {
		assert.equal(mailListRoute(matches([])), undefined);
		assert.equal(mailListRoute([{ routeId: "__root__" }]), undefined);
	});

	it("names the list a thread was opened from, not the thread", () => {
		assert.deepEqual(
			mailListRoute(
				matches([MAIL_BRIEF_ROUTE_ID, `${MAIL_BRIEF_ROUTE_ID}/$threadId`]),
			),
			{ list: "brief" },
		);
		assert.deepEqual(
			mailListRoute(
				matches([MAIL_MAILBOX_ROUTE_ID, `${MAIL_MAILBOX_ROUTE_ID}/$threadId`], {
					mailboxId: "inbox-1",
				}),
			),
			{ list: "mailbox", mailboxId: "inbox-1" },
		);
	});
});

describe("mailViewKey", () => {
	it("gives the four lists four distinct keys", () => {
		const keys = [brief, flagged, outbox, mailbox].map(mailViewKey);
		assert.equal(new Set(keys).size, 4);
	});

	it("distinguishes two mailboxes", () => {
		assert.notEqual(
			mailViewKey(matches([MAIL_MAILBOX_ROUTE_ID], { mailboxId: "inbox-1" })),
			mailViewKey(matches([MAIL_MAILBOX_ROUTE_ID], { mailboxId: "archive-1" })),
		);
	});

	it("is empty outside the mail shell", () => {
		assert.equal(mailViewKey([{ routeId: "__root__" }]), "");
	});

	it("is empty on a mailbox route whose param has not resolved", () => {
		assert.equal(mailViewKey(matches([MAIL_MAILBOX_ROUTE_ID])), "");
	});

	// The trap: opening a thread must not read as leaving the list, or the
	// search field re-seeds and the typed query is gone.
	it("gives a list and its open thread the same key", () => {
		const lists: [readonly string[], Record<string, string> | undefined][] = [
			[[MAIL_BRIEF_ROUTE_ID], undefined],
			[[MAIL_FLAGGED_ROUTE_ID], undefined],
			[[MAIL_OUTBOX_ROUTE_ID], undefined],
			[[MAIL_MAILBOX_ROUTE_ID], { mailboxId: "inbox-1" }],
		];

		for (const [routeIds, params] of lists) {
			const list = routeIds[0];
			const thread = `${list}/$threadId`;
			const message = `${thread}/$messageId`;
			assert.equal(
				mailViewKey(matches([list, thread], params)),
				mailViewKey(matches([list], params)),
				`${list} changes view key when a thread opens`,
			);
			assert.equal(
				mailViewKey(matches([list, thread, message], params)),
				mailViewKey(matches([list], params)),
				`${list} changes view key when a message expands`,
			);
		}
	});

	it("gives a list and its reading-pane index child the same key", () => {
		assert.equal(
			mailViewKey(matches([MAIL_BRIEF_ROUTE_ID, `${MAIL_BRIEF_ROUTE_ID}/`])),
			mailViewKey(brief),
		);
	});
});

/**
 * The router commits the new location before it swaps the matches, so a list on
 * its way off the screen sees its own matches under the destination's address.
 * Anything that acts on "am I the current list" has to ask the pathname.
 */
describe("locationIsOnList", () => {
	it("is true on the list itself", () => {
		assert.equal(locationIsOnList("/mail/brief", "/mail/brief"), true);
		assert.equal(locationIsOnList("/mail/inbox-1", "/mail/inbox-1"), true);
	});

	it("is true for anything the list has open below it", () => {
		assert.equal(
			locationIsOnList("/mail/brief/thread-1/message-1", "/mail/brief"),
			true,
		);
		assert.equal(locationIsOnList("/mail/brief/", "/mail/brief"), true);
		assert.equal(
			locationIsOnList("/mail/inbox-1/compose", "/mail/inbox-1"),
			true,
		);
	});

	it("is false once the address names another list", () => {
		assert.equal(locationIsOnList("/mail/inbox-1", "/mail/brief"), false);
		assert.equal(locationIsOnList("/mail/brief", "/mail/inbox-1"), false);
		assert.equal(locationIsOnList("/mail/archive-1", "/mail/inbox-1"), false);
		assert.equal(locationIsOnList("/mail/flagged", "/mail/brief"), false);
	});

	it("is false outside the mail shell", () => {
		assert.equal(locationIsOnList("/settings/accounts", "/mail/brief"), false);
		assert.equal(locationIsOnList("/onboarding", "/mail/brief"), false);
	});

	it("compares whole segments, so a folder may be named after a list", () => {
		assert.equal(locationIsOnList("/mail/briefing", "/mail/brief"), false);
		assert.equal(locationIsOnList("/mail/outbox-2024", "/mail/outbox"), false);
	});
});

/**
 * What "a thread is open" used to be asked of the query. Everything sharing the
 * single pane with the conversation reads it from the address instead.
 */
describe("locationOpensDetail", () => {
	it("is true for a thread and for the message inside it", () => {
		assert.equal(locationOpensDetail("/mail/brief/thread-1"), true);
		assert.equal(locationOpensDetail("/mail/brief/thread-1/message-1"), true);
		assert.equal(locationOpensDetail("/mail/inbox-1/thread-1"), true);
	});

	it("is false on a bare list, trailing slash and query included", () => {
		assert.equal(locationOpensDetail("/mail/brief"), false);
		assert.equal(locationOpensDetail("/mail/brief/"), false);
		assert.equal(locationOpensDetail("/mail/brief?q=invoice"), false);
		assert.equal(locationOpensDetail("/mail/inbox-1"), false);
		assert.equal(locationOpensDetail("/mail"), false);
	});

	it("is false outside the mail shell", () => {
		assert.equal(locationOpensDetail("/settings/accounts"), false);
		assert.equal(locationOpensDetail("/onboarding"), false);
	});
});
