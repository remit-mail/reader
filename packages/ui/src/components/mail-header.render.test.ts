import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppTopBar } from "./app-top-bar.js";
import { MailHeader, type MailHeaderProps } from "./mail-header.js";
import { SearchBar } from "./search-bar.js";

function render(overrides: Partial<MailHeaderProps> = {}): string {
	return renderToString(
		createElement(MailHeader, {
			title: "Daily brief",
			unreadCount: 15338,
			isDesktop: false,
			searchValue: "",
			onSearchChange: () => undefined,
			searchOpen: false,
			onSearchOpenChange: () => undefined,
			...overrides,
		}),
	);
}

describe("MailHeader", () => {
	it("renders the title and a formatted unread count", () => {
		const html = render();
		assert.match(html, /Daily brief/);
		assert.match(html, /15,338 unread/);
	});

	it("renders the menu (hamburger) control", () => {
		assert.match(render(), /aria-label="Menu"/);
		assert.match(render({ isDesktop: true }), /aria-label="Menu"/);
	});

	it("does not render an account chip row (accounts live in the filter / nav)", () => {
		assert.doesNotMatch(render(), /aria-label="Filters"/);
	});

	it("shows the search magnifier and hides the input when collapsed", () => {
		const html = render({ searchOpen: false });
		assert.match(html, /aria-label="Search"/);
		assert.doesNotMatch(html, /aria-label="Search mail"/);
	});

	it("expands the search input and offers a close control when open", () => {
		const html = render({ searchOpen: true });
		assert.match(html, /aria-label="Search mail"/);
		assert.match(html, /aria-label="Close search"/);
	});

	it("offers a single X when open with a query — close, not a separate inline clear", () => {
		const html = render({ searchOpen: true, searchValue: "invoice" });
		assert.match(html, /aria-label="Close search"/);
		assert.doesNotMatch(html, /aria-label="Clear search"/);
	});

	it("expands the search bar when a query is active even if not explicitly opened", () => {
		const html = render({ searchOpen: false, searchValue: "invoice" });
		assert.match(html, /aria-label="Search mail"/);
		assert.match(html, /aria-label="Close search"/);
		assert.doesNotMatch(html, /aria-label="Search"/);
	});

	it("renders the search bar inline on desktop, keeping its own clear", () => {
		const html = render({ isDesktop: true, searchValue: "invoice" });
		assert.match(html, /aria-label="Search mail"/);
		assert.match(html, /aria-label="Clear search"/);
		assert.match(html, /Daily brief/);
	});
});

/**
 * One search field per page (#49).
 *
 * Moving search into `AppTopBar` puts a second `SearchBar` on the same screen
 * as the list header's own. Two mounted fields compete for the "/" shortcut and
 * for focus, and phase 1's review already found a pair colliding on a shared
 * DOM id. `showSearch` is what holds the count at one, so the count is what
 * these assert.
 */
describe("MailHeader search ownership", () => {
	const countSearchInputs = (html: string): number =>
		html.match(/aria-label="Search mail"/g)?.length ?? 0;

	const topBar = (): string =>
		renderToString(
			createElement(AppTopBar, {
				search: createElement(SearchBar, {
					value: "",
					onChange: () => undefined,
					onClear: () => undefined,
					size: "lg",
				}),
			}),
		);

	it("mounts no search field, and no magnifier, when showSearch is false", () => {
		const html = render({ isDesktop: true, showSearch: false });
		assert.equal(countSearchInputs(html), 0);
		assert.doesNotMatch(html, /aria-label="Search"/);
	});

	it("keeps the title and unread count when search lives elsewhere", () => {
		const html = render({ isDesktop: true, showSearch: false });
		assert.match(html, /Daily brief/);
		assert.match(html, /15,338 unread/);
	});

	it("suppresses the field below desktop too, where the takeover owns search", () => {
		assert.equal(
			countSearchInputs(render({ isDesktop: false, showSearch: false })),
			0,
		);
	});

	it("leaves exactly one field on screen beside the app top bar", () => {
		const combined = topBar() + render({ isDesktop: true, showSearch: false });
		assert.equal(countSearchInputs(combined), 1);
	});

	it("would be two fields if the header kept its own — the premise being guarded", () => {
		const combined = topBar() + render({ isDesktop: true });
		assert.equal(countSearchInputs(combined), 2);
	});
});
