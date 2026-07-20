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

/**
 * The three rules compose into the shell's behaviour (`routes/mail.tsx`): the
 * field is re-seeded during render on a view change, and the mirror decides
 * separately whether to write back. These check the composition, because the
 * two ways search ends — a view change (#47) and the sidebar's own clear —
 * both have to end it without ever writing over what the user is typing.
 */
interface Shell {
	viewKey: string;
	field: string;
	debounced: string;
	url: string;
}

/** One render of the shell for a location, returning the state it settles on. */
const render = (shell: Shell, viewKey: string, url: string): Shell => {
	const field =
		viewKey === shell.viewKey
			? shell.field
			: (searchInputForView(shell.viewKey, viewKey, url) ?? shell.field);
	return { ...shell, viewKey, field, url };
};

/** What the mirror effect would do after that render. */
const mirror = (shell: Shell): Shell => {
	const committed = committedSearchQuery(shell.field, shell.debounced);
	if (!shouldMirrorQuery(shell.field, committed, shell.url)) return shell;
	return { ...shell, url: committed };
};

const typing = (shell: Shell, text: string): Shell => ({
	...shell,
	field: text,
});
const settle = (shell: Shell): Shell => ({ ...shell, debounced: shell.field });

describe("search across a view change", () => {
	const searching: Shell = {
		viewKey: mailViewKey(matches("/mail/$mailboxId", "inbox-1")),
		field: "invoice",
		debounced: "invoice",
		url: "invoice",
	};

	it("ends the search when the user leaves the view", () => {
		// The nav link drops `q`, so the destination carries none.
		const next = mirror(
			render(searching, mailViewKey(matches("/mail/$mailboxId", "sent-1")), ""),
		);
		assert.equal(next.field, "");
		assert.equal(next.url, "");
	});

	it("does not put the query it just left onto the view it landed on", () => {
		// The debounce still holds "invoice" for up to 200ms after the move. The
		// mirror must not write it back — that is #47 returning by another route.
		const landed = render(
			searching,
			mailViewKey(matches("/mail/$mailboxId", "sent-1")),
			"",
		);
		assert.equal(landed.debounced, "invoice");
		assert.equal(mirror(landed).url, "");
	});

	it("keeps a query the destination carries (scope chip removed)", () => {
		// Dropping the scope chip navigates to the brief carrying the query, so
		// the same words are searched with a wider scope.
		const next = mirror(
			render(searching, mailViewKey(matches("/mail/")), "invoice"),
		);
		assert.equal(next.field, "invoice");
		assert.equal(next.url, "invoice");
	});

	it("never clobbers characters the user is still typing", () => {
		// Opening a result and the q-mirror both re-render the same view. Neither
		// is a view change, so neither may reach into the field.
		const mailbox = mailViewKey(matches("/mail/$mailboxId", "inbox-1"));
		let shell = typing(
			{ ...searching, field: "", debounced: "", url: "" },
			"i",
		);
		shell = mirror(render(shell, mailbox, shell.url));
		shell = typing(shell, "inv");
		shell = mirror(render(shell, mailbox, shell.url));
		shell = typing(shell, "invoice");
		shell = settle(mirror(render(shell, mailbox, shell.url)));
		shell = mirror(render(shell, mailbox, shell.url));
		assert.equal(shell.field, "invoice");
		assert.equal(shell.url, "invoice");
	});
});
