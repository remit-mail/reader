import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	FALLBACK_CONTENT_TYPE,
	normalizeAttachmentContentType,
	sanitizeAttachmentFilename,
} from "./outbox-attachment-filename.js";

describe("sanitizeAttachmentFilename", () => {
	it("keeps an ordinary name, accents and spaces included", () => {
		assert.equal(
			sanitizeAttachmentFilename("Facture décembre 2026.pdf"),
			"Facture décembre 2026.pdf",
		);
	});

	it("keeps only the basename of a traversal attempt", () => {
		assert.equal(sanitizeAttachmentFilename("../../../etc/passwd"), "passwd");
	});

	it("keeps only the basename of a windows path", () => {
		assert.equal(
			sanitizeAttachmentFilename("C:\\Users\\me\\Desktop\\report.xlsx"),
			"report.xlsx",
		);
	});

	it("strips the bidi override that disguises an extension", () => {
		assert.equal(
			sanitizeAttachmentFilename("invoice\u202Egnp.exe"),
			"invoicegnp.exe",
		);
	});

	it("strips control characters that would break a header", () => {
		assert.equal(
			sanitizeAttachmentFilename("report\r\nBcc: someone@example.com.pdf"),
			"reportBcc: someone@example.com.pdf",
		);
	});

	it("refuses a name that is nothing but separators and dots", () => {
		assert.equal(sanitizeAttachmentFilename("../.."), null);
		assert.equal(sanitizeAttachmentFilename("."), null);
		assert.equal(sanitizeAttachmentFilename("   "), null);
		assert.equal(sanitizeAttachmentFilename("\u202A\u202B"), null);
	});

	it("truncates an overlong name but keeps its extension", () => {
		const sanitized = sanitizeAttachmentFilename(`${"a".repeat(500)}.pdf`);
		assert.ok(sanitized !== null);
		assert.ok(sanitized.length <= 200);
		assert.ok(sanitized.endsWith(".pdf"));
	});

	it("never cuts an emoji in half when it truncates", () => {
		const sanitized = sanitizeAttachmentFilename(
			`${"a".repeat(195)}\u{1F600}x.pdf`,
		);
		assert.ok(sanitized !== null);
		assert.equal(
			[...sanitized].some((character) => {
				const code = character.charCodeAt(0);
				return code >= 0xd800 && code <= 0xdfff && character.length === 1;
			}),
			false,
		);
		assert.equal(Buffer.from(sanitized, "utf8").includes("\uFFFD"), false);
		assert.ok(sanitized.endsWith(".pdf"));
	});

	it("truncates a name whose trailing dot-segment is not a plausible extension", () => {
		const sanitized = sanitizeAttachmentFilename(
			`${"a".repeat(300)}.${"b".repeat(300)}`,
		);
		assert.ok(sanitized !== null);
		assert.equal(sanitized.length, 200);
	});
});

describe("normalizeAttachmentContentType", () => {
	it("lowercases a media type and drops its parameters", () => {
		assert.equal(
			normalizeAttachmentContentType("TEXT/Plain; charset=utf-8"),
			"text/plain",
		);
	});

	it("passes an archive through — the receiving server decides what it takes", () => {
		assert.equal(
			normalizeAttachmentContentType("application/zip"),
			"application/zip",
		);
	});

	it("falls back when the browser sent nothing", () => {
		assert.equal(normalizeAttachmentContentType(""), FALLBACK_CONTENT_TYPE);
	});

	it("falls back on a token long enough to overflow the field it lands in", () => {
		assert.equal(
			normalizeAttachmentContentType(`application/${"x".repeat(300)}`),
			FALLBACK_CONTENT_TYPE,
		);
	});

	it("falls back on a value that is not a media type", () => {
		assert.equal(
			normalizeAttachmentContentType("text/html<script>"),
			FALLBACK_CONTENT_TYPE,
		);
		assert.equal(
			normalizeAttachmentContentType("not-a-media-type"),
			FALLBACK_CONTENT_TYPE,
		);
	});
});

describe("a filename that hides its separators behind control characters", () => {
	it("takes the basename after the newline, not before it", () => {
		// `.` does not match a newline, so a basename strip that runs first stops
		// at it and leaves every separator that follows.
		assert.equal(
			sanitizeAttachmentFilename("report\r\n/../../.bashrc"),
			"bashrc",
		);
	});

	it("leaves nothing usable when the whole name is separators and a newline", () => {
		assert.equal(sanitizeAttachmentFilename("..\n/../x.png"), "x.png");
	});
});
