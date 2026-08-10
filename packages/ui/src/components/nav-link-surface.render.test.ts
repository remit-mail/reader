import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NavLinkSurface } from "./nav-link-surface.js";

describe("NavLinkSurface", () => {
	it("renders a real anchor carrying the href", () => {
		const html = renderToString(
			createElement(NavLinkSurface, { href: "/mail/brief" }, "Daily brief"),
		);
		assert.match(html, /^<a /);
		assert.match(html, /href="\/mail\/brief"/);
		assert.match(html, /Daily brief/);
	});

	it("renders no href attribute when given none", () => {
		const html = renderToString(
			createElement(NavLinkSurface, {}, "Daily brief"),
		);
		assert.doesNotMatch(html, /href=/);
	});

	it("marks the current destination and styles it", () => {
		const html = renderToString(
			createElement(
				NavLinkSurface,
				{ href: "/mail/brief", current: "page" },
				"Daily brief",
			),
		);
		assert.match(html, /aria-current="page"/);
		assert.match(html, /bg-accent-2-soft/);
		assert.doesNotMatch(html, /text-fg-muted/);
	});

	it("styles a caller-supplied aria-current the same way", () => {
		const html = renderToString(
			createElement(
				NavLinkSurface,
				{ href: "/mail/brief", "aria-current": "page" },
				"Daily brief",
			),
		);
		assert.match(html, /aria-current="page"/);
		assert.match(html, /bg-accent-2-soft/);
	});

	it("treats aria-current=false as not current", () => {
		const html = renderToString(
			createElement(
				NavLinkSurface,
				{ href: "/mail/brief", "aria-current": "false" },
				"Daily brief",
			),
		);
		assert.match(html, /text-fg-muted/);
		assert.doesNotMatch(html, /bg-accent-2-soft/);
	});

	it("carries a focus ring on every variant", () => {
		for (const variant of ["nav", "row", "inline"] as const) {
			const html = renderToString(
				createElement(NavLinkSurface, { href: "/x", variant }, "x"),
			);
			assert.match(html, /focus-visible:ring-2/, variant);
			assert.match(html, /focus-visible:ring-ring/, variant);
		}
	});

	it("rings a full-bleed row inside its own edge", () => {
		const html = renderToString(
			createElement(NavLinkSurface, { href: "/x", variant: "row" }, "x"),
		);
		assert.match(html, /focus-visible:ring-inset/);
		assert.doesNotMatch(html, /ring-offset/);
	});

	it("rings a nav entry outside its own edge", () => {
		const html = renderToString(
			createElement(NavLinkSurface, { href: "/x", variant: "nav" }, "x"),
		);
		assert.match(html, /focus-visible:ring-offset-1/);
		assert.doesNotMatch(html, /ring-inset/);
	});

	it("underlines the inline variant on hover", () => {
		const html = renderToString(
			createElement(NavLinkSurface, { href: "/x", variant: "inline" }, "x"),
		);
		assert.match(html, /hover:underline/);
		assert.match(html, /text-accent/);
	});

	it("lets a caller's className override the variant's own colours", () => {
		const html = renderToString(
			createElement(
				NavLinkSurface,
				{ href: "/x", className: "text-danger" },
				"x",
			),
		);
		assert.match(html, /text-danger/);
		assert.doesNotMatch(html, /text-fg-muted/);
	});

	it("passes anchor attributes straight through", () => {
		const html = renderToString(
			createElement(
				NavLinkSurface,
				{
					href: "https://example.com",
					target: "_blank",
					rel: "noopener noreferrer",
					"data-testid": "nav-link",
					title: "Example",
				},
				"x",
			),
		);
		assert.match(html, /target="_blank"/);
		assert.match(html, /rel="noopener noreferrer"/);
		assert.match(html, /data-testid="nav-link"/);
		assert.match(html, /title="Example"/);
	});
});
