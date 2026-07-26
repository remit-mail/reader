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
import { EmptyStateComparison } from "./message-list-state.stories.js";

const COMPLETENESS = "Every message in this folder was checked.";
const BOUNDED = "Only the messages loaded so far were checked.";

function empty(props: MessageListEmptyProps = {}): string {
	return renderToString(createElement(MessageListEmpty, props));
}

const personal: MessageListFilter = {
	label: "Personal",
	reach: "whole-folder",
	onClear: () => undefined,
};

describe("MessageListLoading", () => {
	const html = renderToString(createElement(MessageListLoading));

	it("renders eight skeleton rows", () => {
		const rows = html.match(/animate-pulse/g) ?? [];
		assert.equal(rows.length, 8, "eight pulse rows, like the live skeleton");
	});

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

	it("keeps the completeness sentence without a scope label", () => {
		const html = empty({ filter: personal });
		assert.match(html, /No Personal mail/);
		assert.match(html, new RegExp(COMPLETENESS));
	});

	it("carries a completeness sentence in every filtered variant", () => {
		const variants: MessageListEmptyProps[] = [
			{ filter: personal },
			{ filter: personal, scopeLabel: "Inbox" },
			{ filter: personal, searchQuery: "invoice" },
			{ filter: personal, scopeLabel: "Inbox", searchQuery: "invoice" },
			{ filter: { ...personal, label: "Unclassified" } },
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

	it("renders the two reaches distinguishably", () => {
		const whole = empty({ filter: personal, scopeLabel: "Inbox" });
		const bounded = empty({
			filter: { ...personal, reach: "loaded-pages" },
			scopeLabel: "Inbox",
		});
		assert.notEqual(whole, bounded);
		assert.doesNotMatch(whole, new RegExp(BOUNDED));
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

	it("renders distinguishably from the skeleton a restarted page shows", () => {
		const filtered = empty({ filter: personal, scopeLabel: "Inbox" });
		const loading = renderToString(createElement(MessageListLoading));
		assert.notEqual(filtered, loading);
		assert.doesNotMatch(filtered, /animate-pulse/);
		assert.doesNotMatch(loading, new RegExp(COMPLETENESS));
	});

	it("renders unclassified as itself, never as personal (#45)", () => {
		const unclassified = empty({
			filter: { ...personal, label: "Unclassified" },
			scopeLabel: "Inbox",
		});
		assert.match(unclassified, /No Unclassified mail in Inbox/);
		assert.doesNotMatch(unclassified, /Personal/);
	});
});

describe("the side-by-side comparison story", () => {
	const html = renderToString(createElement(EmptyStateComparison));

	it("renders both empty states, not one", () => {
		assert.match(html, /No messages in this mailbox/);
		assert.match(html, /No Personal mail in Inbox/);
		assert.match(html, new RegExp(COMPLETENESS));
	});

	it("gives neither panel a fixed width, so a frame cannot clip one away", () => {
		assert.doesNotMatch(html, /\bw-9\d\b/);
		assert.equal((html.match(/flex-1/g) ?? []).length >= 2, true);
	});
});

describe("MessageListLoadingMore", () => {
	const html = renderToString(createElement(MessageListLoadingMore));

	it("says another page is coming in words, not only a spinner", () => {
		assert.match(html, /Loading more/);
	});

	it("announces itself to assistive tech", () => {
		assert.match(html, /role="status"/);
		assert.match(html, /aria-live="polite"/);
	});

	it("renders distinguishably from a filtered empty list", () => {
		const filtered = empty({ filter: personal, scopeLabel: "Inbox" });
		assert.notEqual(html, filtered);
		assert.doesNotMatch(html, new RegExp(COMPLETENESS));
		assert.doesNotMatch(filtered, /Loading more/);
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

	it("offers a way back and a report path when handlers are given", () => {
		const html = renderToString(
			createElement(MessageListError, {
				onRetry: () => {},
				onReport: () => {},
			}),
		);
		assert.match(html, /Retry/);
		assert.match(html, /Report a problem/);
	});

	it("never renders a disabled control", () => {
		const html = renderToString(
			createElement(MessageListError, { onRetry: () => {} }),
		);
		assert.doesNotMatch(html, /\sdisabled[\s=>]/);
	});

	it("reads as a failure, never as an empty result", () => {
		const html = renderToString(
			createElement(MessageListError, { message: "Network unreachable" }),
		);
		assert.doesNotMatch(html, new RegExp(COMPLETENESS));
		assert.doesNotMatch(html, /No messages/);
	});
});
