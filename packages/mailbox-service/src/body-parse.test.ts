/**
 * The boundary the whole quarantine feature rests on: a message defect is a
 * `BodyParseError`, everything else is not. If this type ever wraps something
 * that is not the parser's refusal, an outage becomes a pile of records saying
 * the user's mail is unreadable — and the cursor moves past it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BodyParseError, parseMessageBody } from "./body-parse.js";

const WELL_FORMED = Buffer.from(
	[
		"From: someone@example.com",
		"Subject: hello",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

describe("parseMessageBody", () => {
	it("returns the parsed message when the body is readable", async () => {
		const parsed = await parseMessageBody(WELL_FORMED);
		assert.equal(parsed.subject, "hello");
	});

	it("wraps a parser refusal so the catch site can attribute it", async () => {
		const error = await parseMessageBody(
			// A source the parser has to reject rather than tolerate.
			null as unknown as Buffer,
		).then(
			() => null,
			(err: unknown) => err,
		);

		assert.ok(error instanceof BodyParseError);
		assert.equal(error.name, "BodyParseError");
	});

	it("names an unknown charset, because that defect is identifiable", () => {
		const error = new BodyParseError(new Error("Unknown charset: x-nonesuch"));
		assert.equal(error.failureCode, "UnknownCharset");
	});

	it("refuses to guess a code from parser prose it cannot read", () => {
		const error = new BodyParseError(new Error("something went sideways"));
		assert.equal(error.failureCode, "UnreadableBody");
	});

	it("keeps the parser's own words, which stay on screen and off a report", () => {
		const error = new BodyParseError(new Error("boundary never closed"));
		assert.equal(error.message, "boundary never closed");
	});
});
