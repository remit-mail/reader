import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MailHeader, type MailHeaderProps } from "./mail-header.js";

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

	it("renders the search bar inline on desktop, keeping its own clear", () => {
		const html = render({ isDesktop: true, searchValue: "invoice" });
		assert.match(html, /aria-label="Search mail"/);
		assert.match(html, /aria-label="Clear search"/);
		assert.match(html, /Daily brief/);
	});
});
