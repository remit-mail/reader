import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { KeyboardHintBar, keyboardHintsFor } from "./keyboard-hint-bar.js";

describe("KeyboardHintBar", () => {
	it("offers the app's own set by default", () => {
		const html = renderToString(createElement(KeyboardHintBar));
		assert.match(html, /<span>navigate<\/span>/);
		assert.match(html, /<span>mute<\/span>/);
		assert.match(html, /<span>all shortcuts<\/span>/);
	});

	it("offers only what the host's handlers answer", () => {
		const hints = keyboardHintsFor({ focusNext: () => undefined });
		const html = renderToString(createElement(KeyboardHintBar, { hints }));
		assert.match(html, /<span>navigate<\/span>/);
		assert.doesNotMatch(html, /<span>mute<\/span>/);
		assert.doesNotMatch(html, /<span>all shortcuts<\/span>/);
	});

	it("renders nothing for a host that serves none of them", () => {
		const hints = keyboardHintsFor({ toggleStar: () => undefined });
		assert.deepEqual(hints, []);
		assert.equal(renderToString(createElement(KeyboardHintBar, { hints })), "");
	});
});
