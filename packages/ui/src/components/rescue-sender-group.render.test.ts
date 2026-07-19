import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { RescueCandidate } from "./rescue-candidate-row.js";
import {
	groupRescueCandidatesBySender,
	RescueSenderGroupRow,
} from "./rescue-sender-group.js";

const noop = () => {};

const candidate = (id: string, subject: string): RescueCandidate => ({
	id,
	senderName: "Shop News",
	senderAddress: "news@shop.com",
	subject,
	snippet: "",
	trustReason: "We can verify this sender",
	trustSubReason: "You've emailed them before",
	senderTrust: "wellknown",
});

const [group] = groupRescueCandidatesBySender([
	candidate("a", "Autumn sale"),
	candidate("b", "Winter sale"),
]);

const render = (selected: Set<string>): string =>
	renderToString(
		createElement(RescueSenderGroupRow, {
			group,
			selected,
			onToggleGroup: noop,
			onToggleMessage: noop,
		}),
	);

describe("RescueSenderGroupRow", () => {
	it("states the sender once and the message count instead of repeating rows", () => {
		const html = render(new Set(["a", "b"]));
		assert.match(html, /Shop News/);
		assert.match(html, /2 messages/);
		assert.equal(
			html.split("news@shop.com").length - 1,
			1,
			"the address appears once per sender, not once per message",
		);
	});

	it("keeps the individual messages collapsed until asked for", () => {
		const html = render(new Set(["a", "b"]));
		assert.doesNotMatch(html, /Autumn sale/);
		assert.match(html, /aria-expanded="false"/);
	});

	it("offers one checkbox covering every message from the sender", () => {
		const html = render(new Set(["a", "b"]));
		assert.match(html, /Deselect all 2 messages from Shop News/);
	});

	it("shows a partial selection as indeterminate, not as unselected", () => {
		const html = render(new Set(["a"]));
		assert.doesNotMatch(html, /checked=""/);
		assert.match(html, /Select all 2 messages from Shop News/);
	});
});
