/**
 * The Flagged states #310 stories: the header count and the filtered list.
 *
 * Both used to be a function of how many pages had been loaded. A category
 * whose mail sat below the newest page rendered an empty list, and the number
 * beside the title grew with every press of "Load more" while reading as a
 * total. What is asserted here is that the states are told apart on screen —
 * a filtered empty list from an empty collection, a whole-collection read from
 * a bounded one — and that the header's only two states are a real number and
 * no number.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { flaggedFilterConfig, type MessageListFilter } from "@remit/ui";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flaggedThreads } from "../fixtures/workspace.js";
import { MailShell } from "./mail-shell.js";

const DESKTOP_WIDTH = 1440;

/** One subject as a literal pattern, so punctuation in it stays punctuation. */
const literal = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`);

const personalFilter: MessageListFilter = {
	label: "Personal mail",
	reach: "whole-folder",
	onClear: () => undefined,
};

let root: Root | undefined;

before(async () => {
	(globalThis as { React?: typeof React }).React = React;
});

afterEach(unmount);

function unmount() {
	if (!root) return;
	const current = root;
	act(() => {
		current.unmount();
	});
	root = undefined;
}

type ShellProps = Parameters<typeof MailShell>[0];

/**
 * Render one Flagged state and hand back the markup it produced. A test
 * comparing two states renders them one after the other, so the previous tree
 * comes down first rather than a second root being opened on the same node.
 */
function render(props: Partial<ShellProps>): string {
	unmount();
	const container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
	act(() => {
		root?.render(
			createElement(MailShell, {
				width: DESKTOP_WIDTH,
				selectedNavId: "flagged",
				listTitle: "Starred",
				unreadCount: 42,
				sections: [{ id: "flagged", threads: flaggedThreads }],
				...props,
			} as ShellProps),
		);
	});
	return container.innerHTML;
}

const filteredEmpty = (
	filter: MessageListFilter = personalFilter,
): Partial<ShellProps> => ({
	sections: [],
	listState: "empty",
	listFilter: filter,
	preset: flaggedFilterConfig(),
	briefCategory: "personal",
	unreadCount: 0,
});

describe("Flagged header count", () => {
	it("shows the total the server answered", () => {
		assert.match(render({ unreadCount: 42 }), /42 unread/);
	});

	// The only fallback. A count the server has not given is no number at all,
	// never the length of the pages that happen to be loaded.
	it("shows no number when there is no count", () => {
		assert.doesNotMatch(render({ unreadCount: null }), /unread/);
	});

	// The defect this replaces: the header read `rows.filter(...).length`, so it
	// counted the loaded rows and grew as more were fetched.
	it("does not report the number of rows on screen", () => {
		const html = render({ unreadCount: 42 });
		assert.doesNotMatch(
			html,
			new RegExp(`${flaggedThreads.filter((t) => !t.isRead).length} unread`),
			"the header must not be able to render a page-length count",
		);
	});
});

describe("Flagged empty states", () => {
	it("names the collection instead of calling it a mailbox", () => {
		const html = render({ sections: [], listState: "empty", unreadCount: 0 });
		assert.match(html, /No messages in Starred/);
		assert.doesNotMatch(html, /this mailbox/);
	});

	it("tells a filtered empty list apart from an empty collection", () => {
		const collection = render({
			sections: [],
			listState: "empty",
			unreadCount: 0,
		});
		const filtered = render(filteredEmpty());

		assert.match(filtered, /No Personal mail in Starred/);
		assert.doesNotMatch(filtered, /this mailbox/);
		assert.notEqual(collection, filtered);
	});

	it("says the whole collection was checked, and offers the way out", () => {
		const html = render(filteredEmpty());
		assert.match(html, /Every message in this folder was checked\./);
		assert.match(html, /Clear filter/);
	});

	it("claims only the loaded pages when that is all the filter reached", () => {
		const html = render(
			filteredEmpty({ ...personalFilter, reach: "loaded-pages" }),
		);
		assert.match(html, /Only the messages loaded so far were checked\./);
		assert.doesNotMatch(html, /Every message in this folder was checked\./);
	});

	it("renders the filtered empty state distinctly from the loading one", () => {
		const loading = render({
			sections: [],
			listState: "loading",
			listFilter: personalFilter,
			unreadCount: 0,
		});
		assert.doesNotMatch(loading, /No Personal mail/);
		assert.notEqual(loading, render(filteredEmpty()));
	});
});

describe("Flagged filtered list", () => {
	it("renders the rows the filter returned", () => {
		const personal = flaggedThreads.filter((t) => t.category === "personal");
		assert.ok(personal.length > 0, "the fixture holds personal starred mail");
		const html = render({
			sections: [{ id: "flagged", threads: personal }],
			preset: flaggedFilterConfig(),
			briefCategory: "personal",
			unreadCount: 7,
		});
		for (const thread of personal) {
			assert.match(html, new RegExp(literal(thread.subject)));
		}
	});
});
