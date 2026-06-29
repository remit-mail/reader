import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ComposeFormShell, composeModeLabels } from "./compose-form-shell.js";

describe("ComposeFormShell", () => {
	it("renders header, body and action bar slots in order", () => {
		const html = renderToString(
			createElement(ComposeFormShell, {
				header: createElement("div", null, "HEADER"),
				actionBar: createElement("div", null, "ACTIONBAR"),
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: createElement("div", null, "BODY"),
			}),
		);
		assert.ok(html.indexOf("HEADER") < html.indexOf("BODY"));
		assert.ok(html.indexOf("BODY") < html.indexOf("ACTIONBAR"));
	});

	it("renders the banner and quoted slots when supplied", () => {
		const html = renderToString(
			createElement(ComposeFormShell, {
				banner: createElement("div", null, "BANNER"),
				header: createElement("div", null, "HEADER"),
				quoted: createElement("div", null, "QUOTED"),
				actionBar: createElement("div", null, "BAR"),
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: createElement("div", null, "BODY"),
			}),
		);
		assert.match(html, /BANNER/);
		assert.match(html, /QUOTED/);
	});

	it("omits the quoted region when not supplied", () => {
		const html = renderToString(
			createElement(ComposeFormShell, {
				header: createElement("div", null, "H"),
				actionBar: createElement("div", null, "B"),
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: createElement("div", null, "BODY"),
			}),
		);
		assert.doesNotMatch(html, /pb-2/);
	});

	it("exposes mode labels for every compose mode", () => {
		assert.equal(composeModeLabels.new, "New Message");
		assert.equal(composeModeLabels.reply, "Reply");
		assert.equal(composeModeLabels.reply_all, "Reply All");
		assert.equal(composeModeLabels.forward, "Forward");
	});
});
