import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	type RescueCandidate,
	RescueCandidateRow,
} from "./rescue-candidate-row.js";

const candidate: RescueCandidate = {
	id: "1",
	senderName: "Anna de Vries",
	senderAddress: "anna@studio-noord.nl",
	subject: "Re: invoice",
	snippet: "final files attached",
	trustReason: "We can verify this sender",
	trustSubReason: "You've emailed them before",
	senderTrust: "wellknown",
};

const noop = () => {};

describe("RescueCandidateRow", () => {
	it("renders sender, subject and the plain-language trust reason", () => {
		const html = renderToString(
			createElement(RescueCandidateRow, {
				candidate,
				selected: true,
				onToggle: noop,
			}),
		);
		assert.match(html, /Anna de Vries/);
		assert.match(html, /We can verify this sender/);
		assert.match(html, /emailed them before/);
	});

	it("never leaks authentication jargon to the user", () => {
		const html = renderToString(
			createElement(RescueCandidateRow, {
				candidate,
				selected: false,
				onToggle: noop,
			}),
		);
		assert.doesNotMatch(html, /DKIM|SPF|DMARC/i);
	});

	it("uses a real checkbox that reflects selection", () => {
		const selectedHtml = renderToString(
			createElement(RescueCandidateRow, {
				candidate,
				selected: true,
				onToggle: noop,
			}),
		);
		assert.match(selectedHtml, /type="checkbox"/);
		assert.match(selectedHtml, /checked=""/);

		const unselectedHtml = renderToString(
			createElement(RescueCandidateRow, {
				candidate,
				selected: false,
				onToggle: noop,
			}),
		);
		assert.doesNotMatch(unselectedHtml, /checked=""/);
	});
});
