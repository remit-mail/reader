import assert from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractAttachmentText } from "./extract.js";
import { DEFAULT_EXTRACTION_CONFIG } from "./types.js";

const fixturePath = (name: string): string =>
	fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));

const pdfBytes = readFileSync(fixturePath("sample.pdf"));
const docxBytes = readFileSync(fixturePath("sample.docx"));
const txtBytes = readFileSync(fixturePath("sample.txt"));

test("extracts text from a PDF with a text layer", async () => {
	const result = await extractAttachmentText({
		bytes: pdfBytes,
		declaredMediaType: "application/pdf",
	});

	assert.strictEqual(result.status, "extracted");
	if (result.status !== "extracted") return;
	assert.strictEqual(result.extractor, "pdf");
	assert.match(result.text, /Hello World/);
	assert.strictEqual(result.pages, 1);
	assert.strictEqual(result.truncated, false);
	assert.strictEqual(
		result.charsPerPage,
		result.text.length / (result.pages ?? 1),
	);
});

test("extracts text from a .docx", async () => {
	const result = await extractAttachmentText({
		bytes: docxBytes,
		declaredMediaType:
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		filename: "sample.docx",
	});

	assert.strictEqual(result.status, "extracted");
	if (result.status !== "extracted") return;
	assert.strictEqual(result.extractor, "docx");
	assert.match(result.text, /Hello from a minimal docx fixture/);
	assert.strictEqual(result.truncated, false);
});

test("extracts plain text via UTF-8 decode", async () => {
	const result = await extractAttachmentText({
		bytes: txtBytes,
		declaredMediaType: "text/plain",
		filename: "sample.txt",
	});

	assert.strictEqual(result.status, "extracted");
	if (result.status !== "extracted") return;
	assert.strictEqual(result.extractor, "text");
	assert.match(result.text, /Hello from a plain text fixture/);
});

test("truncates normalized text at the byte limit without splitting a multi-byte UTF-8 sequence", async () => {
	const longText = "café ".repeat(1000);
	const result = await extractAttachmentText(
		{
			bytes: Buffer.from(longText, "utf8"),
			declaredMediaType: "text/plain",
		},
		{ ...DEFAULT_EXTRACTION_CONFIG, maxTextBytes: 100 },
	);

	assert.strictEqual(result.status, "extracted");
	if (result.status !== "extracted") return;
	assert.strictEqual(result.truncated, true);
	assert.ok(Buffer.byteLength(result.text, "utf8") <= 100);
	assert.strictEqual(
		Buffer.from(result.text, "utf8").toString("utf8"),
		result.text,
	);
});

test("returns skipped/too-large before any parsing", async () => {
	const result = await extractAttachmentText(
		{
			bytes: Buffer.alloc(1024, "a"),
			declaredMediaType: "text/plain",
		},
		{ ...DEFAULT_EXTRACTION_CONFIG, maxInputBytes: 10 },
	);

	assert.deepStrictEqual(result, { status: "skipped", reason: "too-large" });
});

test("returns skipped/type-not-allowed for an unsupported declared type", async () => {
	const result = await extractAttachmentText({
		bytes: Buffer.from("PK not really a zip"),
		declaredMediaType: "application/zip",
		filename: "sample.zip",
	});

	assert.deepStrictEqual(result, {
		status: "skipped",
		reason: "type-not-allowed",
	});
});

test("returns failed for a corrupt PDF instead of throwing", async () => {
	const truncatedPdf = pdfBytes.subarray(0, 40);

	const result = await extractAttachmentText({
		bytes: truncatedPdf,
		declaredMediaType: "application/pdf",
	});

	assert.strictEqual(result.status, "failed");
	if (result.status !== "failed") return;
	assert.match(result.reason, /^pdf:/);
});

test("sniffs the media type from magic bytes when the declared type is octet-stream", async () => {
	const result = await extractAttachmentText({
		bytes: pdfBytes,
		declaredMediaType: "application/octet-stream",
	});

	assert.strictEqual(result.status, "extracted");
	if (result.status !== "extracted") return;
	assert.strictEqual(result.extractor, "pdf");
});

test("returns skipped/empty for zero-byte input", async () => {
	const result = await extractAttachmentText({
		bytes: Buffer.alloc(0),
		declaredMediaType: "text/plain",
	});

	assert.deepStrictEqual(result, { status: "skipped", reason: "empty" });
});

test("returns skipped/empty when extracted text is whitespace-only", async () => {
	const result = await extractAttachmentText({
		bytes: Buffer.from("   \n\n\t  "),
		declaredMediaType: "text/plain",
	});

	assert.deepStrictEqual(result, { status: "skipped", reason: "empty" });
});
