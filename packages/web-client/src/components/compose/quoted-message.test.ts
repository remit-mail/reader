/**
 * Issue #845.5: the quoted original was a layout slot and never part of the
 * body, so a forward left carrying the signature alone. These hold the two
 * halves of what a send now carries — the block itself, and its merge into the
 * two body columns in each of the two body modes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapDescribeMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { RichTextValue } from "@remit/ui";
import { buildQuotedBlock, outgoingBody } from "./quoted-message";

type Envelope = RemitImapDescribeMessageResponse["envelope"];

const envelope = {
	subject: "Lunch",
	date: Date.UTC(2026, 5, 24, 9, 14),
	messageIdValue: "<m1@example.com>",
	from: [
		{ normalizedEmail: "dana@example.com", displayName: "Dana Whitfield" },
	],
	replyTo: [],
	to: [{ normalizedEmail: "me@example.com", displayName: "Me" }],
	cc: [],
} as unknown as Envelope;

const written = (text: string, html: string): RichTextValue => ({
	text,
	html,
	formatting: [],
});

describe("the quoted original a reply carries", () => {
	const block = buildQuotedBlock("reply", envelope, {
		kind: "text",
		content: "Are we still on for Thursday?\n\nI can do 12:30.",
	});

	it("opens on the attribution line the rest of the tree recognises", () => {
		assert.match(block.text.split("\n")[0] ?? "", /^On .+ wrote:$/);
		assert.match(block.text, /Dana Whitfield <dana@example\.com>/);
	});

	it("indents every line of the original behind it", () => {
		assert.match(block.text, /^> Are we still on for Thursday\?$/m);
		assert.match(block.text, /^> I can do 12:30\.$/m);
	});

	it("carries the same original in the HTML column, as a quote", () => {
		assert.match(block.html, /<blockquote type="cite">/);
		assert.match(block.html, /Are we still on for Thursday\?/);
	});
});

describe("the quoted original a forward carries", () => {
	const block = buildQuotedBlock(
		"forward",
		{
			...envelope,
			cc: [{ normalizedEmail: "sam@example.com" }],
		} as unknown as Envelope,
		{ kind: "text", content: "Are we still on for Thursday?" },
	);

	it("states who wrote it, when, about what and to whom", () => {
		assert.match(block.text, /^-+ Forwarded message -+$/m);
		assert.match(block.text, /^From: Dana Whitfield <dana@example\.com>$/m);
		assert.match(block.text, /^Subject: Lunch$/m);
		assert.match(block.text, /^To: Me <me@example\.com>$/m);
		assert.match(block.text, /^Cc: sam@example\.com$/m);
	});

	it("passes the original on whole rather than quoting it", () => {
		assert.match(block.text, /^Are we still on for Thursday\?$/m);
		assert.doesNotMatch(block.text, /^> /m);
	});

	it("carries the header and the original in the HTML column", () => {
		assert.match(block.html, /Forwarded message/);
		assert.match(block.html, /Subject: Lunch/);
		assert.match(block.html, /Are we still on for Thursday\?/);
	});
});

describe("the two representations of one original", () => {
	it("reads an HTML original into lines for the text column", () => {
		const block = buildQuotedBlock("reply", envelope, {
			kind: "html",
			content: "<p>First paragraph.</p><p>Second paragraph.</p>",
		});
		assert.match(block.text, /^> First paragraph\.$/m);
		assert.match(block.text, /^> Second paragraph\.$/m);
		assert.doesNotMatch(block.text, /<p>|<\/p>/);
	});

	it("escapes a plain-text original on its way into the HTML column", () => {
		const block = buildQuotedBlock("reply", envelope, {
			kind: "text",
			content: '5 < 6 & "quoted"',
		});
		assert.match(block.html, /5 &lt; 6 &amp; &quot;quoted&quot;/);
		assert.match(block.text, /5 < 6 & "quoted"/);
	});
});

describe("the body a send leaves with", () => {
	const block = buildQuotedBlock("reply", envelope, {
		kind: "text",
		content: "Are we still on for Thursday?",
	});

	it("carries the answer and the original in both columns, in rich mode", () => {
		const body = outgoingBody(
			"rich",
			written("Yes, 12:30 works.", "<p>Yes, 12:30 works.</p>"),
			"en",
			block,
		);
		assert.match(body.textBody ?? "", /Yes, 12:30 works\./);
		assert.match(body.textBody ?? "", /^> Are we still on for Thursday\?$/m);
		assert.match(body.htmlBody ?? "", /Yes, 12:30 works\./);
		assert.match(body.htmlBody ?? "", /<blockquote type="cite">/);
		assert.match(body.htmlBody ?? "", /^<div lang="en">/);
	});

	it("carries the original in the text column alone, in plain mode", () => {
		const body = outgoingBody(
			"plain",
			written("Yes, 12:30 works.", ""),
			"en",
			block,
		);
		assert.match(body.textBody ?? "", /Yes, 12:30 works\./);
		assert.match(body.textBody ?? "", /^> Are we still on for Thursday\?$/m);
		assert.doesNotMatch(body.textBody ?? "", /<blockquote/);
		// An HTML column here would reopen the draft as rich and send the
		// recipient an HTML alternative of a message written as plain text.
		assert.equal(body.htmlBody, "");
	});

	it("sends the quote when the editor has not reported its document yet", () => {
		const body = outgoingBody("rich", written("", ""), "en", block);
		assert.match(body.textBody ?? "", /^> Are we still on for Thursday\?$/m);
		assert.match(body.htmlBody ?? "", /<blockquote type="cite">/);
	});

	it("writes what it always wrote when there is nothing to quote", () => {
		const body = outgoingBody(
			"rich",
			written("A new message.", "<p>A new message.</p>"),
			"en",
			undefined,
		);
		assert.equal(body.textBody, "A new message.");
		assert.equal(body.htmlBody, '<div lang="en"><p>A new message.</p></div>');
	});
});
