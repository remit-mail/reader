import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatByteSize,
	sanitizeAttachmentFilename,
} from "./attachment-file.js";

const RLO = "\u202e";
const LRI = "\u2066";
const PDI = "\u2069";
const ZWSP = "\u200b";
const BOM = "\ufeff";

describe("sanitizeAttachmentFilename", () => {
	it("leaves an ordinary filename alone", () => {
		assert.equal(
			sanitizeAttachmentFilename("Quarterly report.pdf"),
			"Quarterly report.pdf",
		);
	});

	it("keeps only the last segment of a POSIX path", () => {
		assert.equal(sanitizeAttachmentFilename("../../../etc/passwd"), "passwd");
	});

	it("keeps only the last segment of a Windows path", () => {
		assert.equal(
			sanitizeAttachmentFilename("..\\..\\Windows\\System32\\evil.dll"),
			"evil.dll",
		);
	});

	it("falls back when the name is nothing but traversal", () => {
		assert.equal(sanitizeAttachmentFilename("../../"), "attachment");
	});

	it("uses the caller's fallback when nothing usable survives", () => {
		assert.equal(
			sanitizeAttachmentFilename("   ", "attachment.pdf"),
			"attachment.pdf",
		);
	});

	it("strips the right-to-left override that disguises an extension", () => {
		assert.equal(
			sanitizeAttachmentFilename(`invoice${RLO}gnp.exe`),
			"invoicegnp.exe",
		);
	});

	it("strips bidi isolates, zero-width and BOM characters", () => {
		assert.equal(
			sanitizeAttachmentFilename(`${LRI}re${ZWSP}port${PDI}${BOM}.pdf`),
			"report.pdf",
		);
	});

	it("strips control characters that would break a header line", () => {
		assert.equal(
			sanitizeAttachmentFilename("note\r\n\tX-Evil 1.txt"),
			"noteX-Evil 1.txt",
		);
	});

	it("replaces characters that are illegal in a path", () => {
		assert.equal(
			sanitizeAttachmentFilename('re<po>rt|"?*.txt'),
			"re_po_rt____.txt",
		);
	});

	it("drops a leading dot so the file cannot land hidden", () => {
		assert.equal(sanitizeAttachmentFilename(".bashrc"), "bashrc");
	});

	it("drops trailing dots and spaces", () => {
		assert.equal(sanitizeAttachmentFilename("report.pdf. . "), "report.pdf");
	});

	it("guards a reserved Windows device name", () => {
		assert.equal(sanitizeAttachmentFilename("NUL.txt"), "_NUL.txt");
		assert.equal(sanitizeAttachmentFilename("com1"), "_com1");
	});

	it("does not guard a name that merely starts with a device name", () => {
		assert.equal(sanitizeAttachmentFilename("console.log"), "console.log");
	});

	it("clamps an overlong name and keeps its extension", () => {
		const result = sanitizeAttachmentFilename(`${"a".repeat(400)}.pdf`);
		assert.equal(result.length, 120);
		assert.ok(result.endsWith(".pdf"));
	});

	it("clamps an overlong name that has no extension", () => {
		assert.equal(sanitizeAttachmentFilename("b".repeat(400)), "b".repeat(120));
	});

	it("clamps an overlong trailing segment rather than treating it as an extension", () => {
		assert.equal(
			sanitizeAttachmentFilename(`${"c".repeat(200)}.${"d".repeat(40)}`),
			"c".repeat(120),
		);
	});

	it("clamps an overlong fallback too", () => {
		const result = sanitizeAttachmentFilename(
			"",
			`attachment.${"x".repeat(400)}`,
		);
		assert.equal(result.length, 120);
	});

	it("clamps on characters, never splitting a surrogate pair", () => {
		const result = sanitizeAttachmentFilename(`${"😀".repeat(200)}.pdf`);
		assert.equal([...result].length, 120);
		assert.ok(result.endsWith(".pdf"));
		assert.equal(/[\ud800-\udfff]/.test(result.replaceAll("😀", "")), false);
	});
});

describe("formatByteSize", () => {
	it("counts small payloads in bytes", () => {
		assert.equal(formatByteSize(0), "0 bytes");
		assert.equal(formatByteSize(1), "1 byte");
		assert.equal(formatByteSize(1023), "1023 bytes");
	});

	it("switches to kilobytes at 1024", () => {
		assert.equal(formatByteSize(1024), "1 KB");
		assert.equal(formatByteSize(1536), "1.5 KB");
		assert.equal(formatByteSize(1024 * 999), "999 KB");
	});

	it("switches to megabytes, gigabytes and terabytes", () => {
		assert.equal(formatByteSize(1024 * 1024), "1 MB");
		assert.equal(formatByteSize(1024 * 1024 * 2.5), "2.5 MB");
		assert.equal(formatByteSize(1024 ** 3), "1 GB");
		assert.equal(formatByteSize(1024 ** 4), "1 TB");
	});

	it("promotes at the point one decimal would round up to 1024", () => {
		assert.equal(formatByteSize(1024 * 1023), "1023 KB");
		assert.equal(formatByteSize(1024 * 1024 - 6), "1 MB");
		assert.equal(formatByteSize(1024 ** 3 - 1), "1 GB");
		assert.equal(formatByteSize(1024 ** 4 - 1), "1 TB");
	});

	it("stays in terabytes rather than inventing a larger unit", () => {
		assert.equal(formatByteSize(1024 ** 5), "1024 TB");
	});

	it("drops the decimal once the value no longer needs it", () => {
		assert.equal(formatByteSize(1024 * 1024 * 14.04), "14 MB");
	});

	it("reads as unknown for a size that was never declared", () => {
		assert.equal(formatByteSize(Number.NaN), "unknown size");
		assert.equal(formatByteSize(-1), "unknown size");
		assert.equal(formatByteSize(Number.POSITIVE_INFINITY), "unknown size");
	});
});
