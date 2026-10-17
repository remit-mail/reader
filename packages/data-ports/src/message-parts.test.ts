import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	encapsulatedParts,
	isEncapsulatedMessage,
	outermostMessages,
	ownParts,
} from "./message-parts.js";

const part = (partPath: string, mediaType: string, mediaSubtype: string) => ({
	partPath,
	mediaType,
	mediaSubtype,
});

const FORWARD_IN_FORWARD = [
	part("0", "MULTIPART", "mixed"),
	part("1", "TEXT", "plain"),
	part("2", "MESSAGE", "rfc822"),
	part("2.0", "MULTIPART", "mixed"),
	part("2.1", "TEXT", "plain"),
	part("2.2", "MESSAGE", "rfc822"),
	part("2.2.0", "TEXT", "plain"),
	part("3", "APPLICATION", "pdf"),
];

const paths = (parts: readonly { partPath: string }[]): string[] =>
	parts.map((p) => p.partPath);

describe("which message a part belongs to", () => {
	it("knows a forwarded message whatever the case of its type", () => {
		assert.equal(isEncapsulatedMessage(part("2", "MESSAGE", "rfc822")), true);
		assert.equal(isEncapsulatedMessage(part("2", "message", "RFC822")), true);
		assert.equal(isEncapsulatedMessage(part("2", "Message", "Global")), true);
	});

	it("does not take a delivery report for a forwarded message", () => {
		assert.equal(
			isEncapsulatedMessage(part("2", "MESSAGE", "delivery-status")),
			false,
		);
	});

	it("keeps a message's own parts and drops the forwarded message's", () => {
		assert.deepEqual(paths(ownParts(FORWARD_IN_FORWARD)), ["0", "1", "2", "3"]);
	});

	it("gives the forwarded message its parts, nested forwards included", () => {
		assert.deepEqual(paths(encapsulatedParts(FORWARD_IN_FORWARD, "2")), [
			"2.0",
			"2.1",
			"2.2",
			"2.2.0",
		]);
		assert.deepEqual(
			paths(ownParts(encapsulatedParts(FORWARD_IN_FORWARD, "2"))),
			["2.0", "2.1", "2.2"],
		);
	});

	it("names only the forwarded messages the message itself carries", () => {
		assert.deepEqual(paths(outermostMessages(FORWARD_IN_FORWARD)), ["2"]);
	});

	it("does not mistake part 20 for a part of message 2", () => {
		assert.deepEqual(
			paths(
				ownParts([part("2", "MESSAGE", "rfc822"), part("20", "TEXT", "plain")]),
			),
			["2", "20"],
		);
	});
});
