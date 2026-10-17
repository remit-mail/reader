import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	MessageListEmpty,
	type MessageListEmptyProps,
	MessageListError,
	type MessageListFilter,
	MessageListLoading,
	MessageListLoadingMore,
} from "./message-list-state.js";

const COMPLETENESS = "Every message in this folder was checked.";
const BOUNDED = "Only the messages loaded so far were checked.";

function empty(props: MessageListEmptyProps = {}): string {
	return renderToString(createElement(MessageListEmpty, props));
}

const personal: MessageListFilter = {
	label: "Personal mail",
	reach: "whole-folder",
	onClear: () => undefined,
};

describe("MessageListLoading", () => {
	const html = renderToString(createElement(MessageListLoading));

	it("marks the region busy for assistive tech", () => {
		assert.match(html, /aria-busy="true"/);
	});
});

describe("MessageListEmpty", () => {
	it("uses the plain mailbox copy with no query", () => {
		assert.match(empty(), /No messages in this mailbox/);
	});

	it("switches to the search copy when a query is active", () => {
		assert.match(
			empty({ searchQuery: "invoice" }),
			/No messages match your search/,
		);
	});

	it("treats a whitespace-only query as no search", () => {
		assert.match(empty({ searchQuery: "   " }), /No messages in this mailbox/);
	});

	it("names a collection that is not a mailbox instead of calling it one", () => {
		const html = empty({ scopeLabel: "Starred" });
		assert.match(html, /No messages in Starred/);
		assert.doesNotMatch(html, /this mailbox/);
	});

	it("claims no completeness when nothing was filtered", () => {
		assert.doesNotMatch(empty(), new RegExp(COMPLETENESS));
		assert.doesNotMatch(
			empty({ searchQuery: "invoice" }),
			new RegExp(COMPLETENESS),
		);
	});
});

describe("MessageListEmpty under a filter", () => {
	it("names the filter and the folder, and says the folder was fully read", () => {
		const html = empty({ filter: personal, scopeLabel: "Inbox" });
		assert.match(html, /No Personal mail in Inbox/);
		assert.match(html, new RegExp(COMPLETENESS));
	});

	it("carries a completeness sentence in every filtered variant", () => {
		const variants: MessageListEmptyProps[] = [
			{ filter: personal },
			{ filter: personal, scopeLabel: "Inbox" },
			{ filter: personal, searchQuery: "invoice" },
			{ filter: personal, scopeLabel: "Inbox", searchQuery: "invoice" },
			{ filter: { ...personal, label: "Unclassified mail" } },
			{ filter: { ...personal, reach: "loaded-pages" } },
			{ filter: { ...personal, reach: "loaded-pages" }, scopeLabel: "Inbox" },
		];
		for (const props of variants) {
			assert.match(empty(props), new RegExp(`${COMPLETENESS}|${BOUNDED}`));
		}
	});

	it("claims the whole folder only when the filter reached it", () => {
		const bounded = empty({
			filter: { ...personal, reach: "loaded-pages" },
			scopeLabel: "Inbox",
		});
		assert.match(bounded, new RegExp(BOUNDED));
		assert.doesNotMatch(
			bounded,
			new RegExp(COMPLETENESS),
			"a bounded read must not claim the folder was fully checked",
		);
	});

	it("leads with the query when searching inside a filter", () => {
		const html = empty({
			filter: personal,
			scopeLabel: "Inbox",
			searchQuery: "invoice",
		});
		assert.match(html, /No results for “invoice” in Personal/);
		assert.match(html, new RegExp(COMPLETENESS));
	});

	it("names a narrowing that is not a category at all (#1126)", () => {
		const html = empty({
			filter: { ...personal, label: "unread mail" },
			scopeLabel: "Starred",
		});
		assert.match(html, /No unread mail in Starred/);
		assert.match(html, new RegExp(COMPLETENESS));
		assert.match(html, /Clear filter/);
		assert.doesNotMatch(html, /No messages in Starred/);
	});

	it("offers the way out of the filter", () => {
		assert.match(empty({ filter: personal }), /Clear filter/);
	});

	it("renders distinguishably from an unfiltered empty mailbox (#315)", () => {
		const unfiltered = empty();
		const filtered = empty({ filter: personal, scopeLabel: "Inbox" });
		assert.notEqual(unfiltered, filtered);
		assert.doesNotMatch(filtered, /No messages in this mailbox/);
		assert.doesNotMatch(unfiltered, /Clear filter/);
	});
});

describe("MessageListLoadingMore", () => {
	const html = renderToString(createElement(MessageListLoadingMore));

	it("announces itself to assistive tech", () => {
		assert.match(html, /role="status"/);
		assert.match(html, /aria-live="polite"/);
	});
});

describe("MessageListError", () => {
	it("fails hard: alert role, plain failure line, and the detail message", () => {
		const html = renderToString(
			createElement(MessageListError, { message: "Network unreachable" }),
		);
		assert.match(html, /role="alert"/, "blocking alert, never a toast");
		assert.match(html, /Couldn&#x27;t load messages/, "plain failure line");
		assert.match(html, /Network unreachable/);
	});

	it("never renders a disabled control", () => {
		const html = renderToString(
			createElement(MessageListError, { onRetry: () => {} }),
		);
		assert.doesNotMatch(html, /\sdisabled[\s=>]/);
	});
});
