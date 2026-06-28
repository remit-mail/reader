import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { MoveMailboxOption } from "./move-mailbox-picker.js";
import type { RescueCandidate } from "./rescue-candidate-row.js";
import {
	RescueFromSpamFlow,
	rescueMoveConsequence,
} from "./rescue-from-spam-flow.js";

const noop = () => {};

const candidates: RescueCandidate[] = [
	{
		id: "c1",
		senderName: "Anna de Vries",
		senderAddress: "anna@studio-noord.nl",
		subject: "Re: invoice for the September shoot",
		snippet: "Final files attached as agreed.",
		trustReason: "We can verify this sender",
		trustSubReason: "You've emailed them before",
		senderTrust: "wellknown",
	},
	{
		id: "c2",
		senderName: "Mum",
		senderAddress: "mum@gmail.com",
		subject: "dinner sunday?",
		snippet: "Are you coming over?",
		trustReason: "We can verify this sender",
		trustSubReason: "A sender you know",
		senderTrust: "vip",
	},
];

const folders: MoveMailboxOption[] = [
	{ id: "inbox", label: "Inbox" },
	{ id: "spam", label: "Spam", isCurrent: true },
];

const renderFlow = (open: boolean): string =>
	renderToString(
		createElement(RescueFromSpamFlow, {
			open,
			candidates,
			defaultDestinationId: "inbox",
			availableFolders: folders,
			onConfirmMove: noop,
			onCancel: noop,
		}),
	);

describe("RescueFromSpamFlow", () => {
	it("opens on the review step listing every candidate", () => {
		const html = renderFlow(true);
		assert.match(html, /Rescue from Spam/);
		assert.match(html, /Anna de Vries/);
		assert.match(html, /Mum/);
	});

	it("pre-selects all candidates and shows the live count", () => {
		const html = renderFlow(true);
		assert.match(html, /2 of 2 selected/);
		assert.match(html, /Continue with 2 messages/);
	});

	it("offers select-all / none and a way back", () => {
		const html = renderFlow(true);
		assert.match(html, /Select all/);
		assert.match(html, /Select none/);
		assert.match(html, /Cancel/);
		assert.match(html, /Why these\?/);
	});

	it("never leaks authentication jargon", () => {
		const html = renderFlow(true);
		assert.doesNotMatch(html, /DKIM|SPF|DMARC|spam score|predicate/i);
	});
});

describe("rescueMoveConsequence", () => {
	it("states a one-off move with destination and count", () => {
		assert.equal(
			rescueMoveConsequence(3, "Inbox"),
			"Moves these 3 messages out of Spam to Inbox now. Nothing later.",
		);
	});

	it("uses the singular form for one message", () => {
		assert.equal(
			rescueMoveConsequence(1, "Family"),
			"Moves this message out of Spam to Family now. Nothing later.",
		);
	});

	it("always promises nothing ongoing", () => {
		assert.match(rescueMoveConsequence(9, "Inbox"), /Nothing later\.$/);
	});
});
