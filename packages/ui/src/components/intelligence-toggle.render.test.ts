/**
 * Render invariants for the (i) intelligence toggle (#52): the control holds
 * its slot in the toolbar on every view and in every selection state, and
 * reports "cannot act" by being disabled rather than by disappearing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { IntelligenceToggle } from "./intelligence-toggle.js";

const render = (props: Parameters<typeof IntelligenceToggle>[0]): string =>
	renderToString(createElement(IntelligenceToggle, props));

describe("IntelligenceToggle", () => {
	it("renders the button when it cannot act", () => {
		const html = render({ enabled: false });
		assert.match(html, /aria-label="Show intelligence sidebar"/);
	});

	it("disables rather than hides the button when it cannot act", () => {
		const html = render({ enabled: false });
		assert.match(html, /\sdisabled(=""|\s|>)/);
	});

	it("is pressable when a thread is open and a rail exists", () => {
		const html = render({ enabled: true });
		assert.equal(/\sdisabled(=""|\s|>)/.test(html), false);
	});

	it("stays rendered while the rail is open so it can close it again", () => {
		const html = render({ enabled: true, open: true });
		assert.match(html, /aria-label="Hide intelligence sidebar"/);
		assert.match(html, /aria-pressed="true"/);
	});
});
