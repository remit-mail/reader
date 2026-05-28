import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import type { BodyPartItem } from "@remit/remit-electrodb-service";
import type { Attachment, ParsedMail } from "mailparser";
import { mapBodyPartsToContent } from "./body-part-mapper.js";

type LeafInput = Pick<
	BodyPartItem,
	| "partPath"
	| "isMultipart"
	| "mediaType"
	| "mediaSubtype"
	| "contentId"
	| "dispositionFilename"
	| "disposition"
>;

const buildAttachment = (overrides: Partial<Attachment>): Attachment =>
	({
		type: "attachment",
		content: Buffer.from(""),
		contentType: "application/octet-stream",
		contentDisposition: "attachment",
		headers: new Map(),
		headerLines: [],
		checksum: "",
		size: 0,
		related: false,
		...overrides,
	}) as Attachment;

const buildParsed = (overrides: Partial<ParsedMail>): ParsedMail =>
	({
		attachments: [],
		headers: new Map(),
		headerLines: [],
		text: undefined,
		html: false,
		...overrides,
	}) as ParsedMail;

describe("mapBodyPartsToContent", () => {
	it("maps text/plain + text/html leaves to parsed.text and parsed.html", () => {
		const parts: LeafInput[] = [
			{
				partPath: "0",
				isMultipart: true,
				mediaType: "MULTIPART",
				mediaSubtype: "alternative",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: undefined,
			},
			{
				partPath: "1",
				isMultipart: false,
				mediaType: "TEXT",
				mediaSubtype: "plain",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: undefined,
			},
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "TEXT",
				mediaSubtype: "html",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: undefined,
			},
		];

		const parsed = buildParsed({
			text: "hello alice",
			html: "<p>hello bob</p>",
		});

		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);

		assert.equal(unresolved.length, 0);
		assert.equal(mapped.length, 2);
		assert.equal(mapped[0].partPath, "1");
		assert.equal(mapped[0].contentType, "text/plain");
		assert.equal(mapped[0].content.toString("utf8"), "hello alice");
		assert.equal(mapped[1].partPath, "2");
		assert.equal(mapped[1].contentType, "text/html");
		assert.equal(mapped[1].content.toString("utf8"), "<p>hello bob</p>");
	});

	it("matches inline image leaves to attachments by Content-ID (case + angle-insensitive)", () => {
		const parts: LeafInput[] = [
			{
				partPath: "1",
				isMultipart: false,
				mediaType: "TEXT",
				mediaSubtype: "html",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: undefined,
			},
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "IMAGE",
				mediaSubtype: "png",
				contentId: "<bob-avatar@example.com>",
				dispositionFilename: "bob-avatar.png",
				disposition: "inline",
			},
		];

		const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
		const parsed = buildParsed({
			html: '<p>hello <img src="cid:bob-avatar@example.com"></p>',
			attachments: [
				buildAttachment({
					content: pngBytes,
					contentType: "image/png",
					filename: "bob-avatar.png",
					cid: "bob-avatar@example.com",
				}),
			],
		});

		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);

		assert.equal(unresolved.length, 0);
		assert.equal(mapped.length, 2);
		const img = mapped.find((r) => r.partPath === "2");
		assert.ok(img);
		assert.equal(img.contentType, "image/png");
		assert.deepEqual(img.content, pngBytes);
	});

	it("falls back to (contentType + filename) when no Content-ID is set", () => {
		const parts: LeafInput[] = [
			{
				partPath: "1",
				isMultipart: false,
				mediaType: "APPLICATION",
				mediaSubtype: "pdf",
				contentId: undefined,
				dispositionFilename: "alice-resume.pdf",
				disposition: "attachment",
			},
		];

		const pdfBytes = Buffer.from("%PDF-1.4\n");
		const parsed = buildParsed({
			attachments: [
				buildAttachment({
					content: pdfBytes,
					contentType: "application/pdf",
					filename: "alice-resume.pdf",
				}),
			],
		});

		const { mapped } = mapBodyPartsToContent(parts, parsed);
		assert.equal(mapped.length, 1);
		assert.equal(mapped[0].partPath, "1");
		assert.deepEqual(mapped[0].content, pdfBytes);
	});

	it("does not double-consume the same attachment when two leaves share contentType+filename", () => {
		const parts: LeafInput[] = [
			{
				partPath: "1",
				isMultipart: false,
				mediaType: "APPLICATION",
				mediaSubtype: "pdf",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: "attachment",
			},
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "APPLICATION",
				mediaSubtype: "pdf",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: "attachment",
			},
		];

		const a = Buffer.from("%PDF-A");
		const b = Buffer.from("%PDF-B");
		const parsed = buildParsed({
			attachments: [
				buildAttachment({ content: a, contentType: "application/pdf" }),
				buildAttachment({ content: b, contentType: "application/pdf" }),
			],
		});

		const { mapped } = mapBodyPartsToContent(parts, parsed);
		assert.deepEqual(mapped[0].content, a);
		assert.deepEqual(mapped[1].content, b);
	});

	it("returns the leaf in `unresolved` (no throw) when no parsed content matches", () => {
		const parts: LeafInput[] = [
			{
				partPath: "5",
				isMultipart: false,
				mediaType: "IMAGE",
				mediaSubtype: "png",
				contentId: "<missing@example.com>",
				dispositionFilename: undefined,
				disposition: "inline",
			},
		];

		const parsed = buildParsed({});

		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);
		assert.equal(mapped.length, 0);
		assert.equal(unresolved.length, 1);
		assert.equal(unresolved[0].partPath, "5");
		assert.match(
			unresolved[0].reason,
			/no parsed-mail content for partPath="5"/,
		);
		assert.equal(unresolved[0].disposition, "inline");
	});

	it("skips multipart container rows entirely (no bytes of their own)", () => {
		const parts: LeafInput[] = [
			{
				partPath: "0",
				isMultipart: true,
				mediaType: "MULTIPART",
				mediaSubtype: "mixed",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: undefined,
			},
		];
		const parsed = buildParsed({});
		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);
		assert.deepEqual(mapped, []);
		assert.deepEqual(unresolved, []);
	});

	// The bug from production: IMAP BODYSTRUCTURE labelled the attachment
	// `application/octet-stream` but mailparser sniffed `application/pdf`
	// from the filename. Old strict-equality check threw; new code accepts
	// it because the filename matches.
	it("matches an application/octet-stream row to application/pdf when the filename matches (Odido bug)", () => {
		const parts: LeafInput[] = [
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "APPLICATION",
				mediaSubtype: "octet-stream",
				contentId: undefined,
				dispositionFilename: "Jouw_Odido_Contract_28052026_00001.pdf",
				disposition: "attachment",
			},
		];

		const pdfBytes = Buffer.from("%PDF-1.4\nOdido");
		const parsed = buildParsed({
			attachments: [
				buildAttachment({
					content: pdfBytes,
					contentType: "application/pdf",
					filename: "Jouw_Odido_Contract_28052026_00001.pdf",
				}),
			],
		});

		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);
		assert.equal(unresolved.length, 0);
		assert.equal(mapped.length, 1);
		assert.equal(mapped[0].partPath, "2");
		assert.equal(mapped[0].contentType, "application/octet-stream");
		assert.deepEqual(mapped[0].content, pdfBytes);
	});

	it("matches filename case-insensitively when types disagree", () => {
		const parts: LeafInput[] = [
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "APPLICATION",
				mediaSubtype: "octet-stream",
				contentId: undefined,
				dispositionFilename: "Factuur-GVR8590037.PDF",
				disposition: "attachment",
			},
		];
		const pdfBytes = Buffer.from("%PDF-1.4\nINV");
		const parsed = buildParsed({
			attachments: [
				buildAttachment({
					content: pdfBytes,
					contentType: "application/pdf",
					filename: "factuur-gvr8590037.pdf",
				}),
			],
		});

		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);
		assert.equal(unresolved.length, 0);
		assert.equal(mapped.length, 1);
		assert.deepEqual(mapped[0].content, pdfBytes);
	});

	it("octet-stream + no filename accepts a non-text attachment as last resort", () => {
		const parts: LeafInput[] = [
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "APPLICATION",
				mediaSubtype: "octet-stream",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: "attachment",
			},
		];
		const blob = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
		const parsed = buildParsed({
			attachments: [
				buildAttachment({
					content: blob,
					contentType: "image/jpeg",
				}),
			],
		});

		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);
		assert.equal(unresolved.length, 0);
		assert.equal(mapped.length, 1);
		assert.deepEqual(mapped[0].content, blob);
	});

	// The corresponding negative case: don't false-positive an octet-stream
	// row onto a text/html attachment — that would re-route inline HTML
	// into an attachment slot.
	it("octet-stream + no filename does NOT match a text/html attachment", () => {
		const parts: LeafInput[] = [
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "APPLICATION",
				mediaSubtype: "octet-stream",
				contentId: undefined,
				dispositionFilename: undefined,
				disposition: "attachment",
			},
		];
		const htmlBytes = Buffer.from("<p>nope</p>");
		const parsed = buildParsed({
			attachments: [
				buildAttachment({
					content: htmlBytes,
					contentType: "text/html",
				}),
			],
		});

		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);
		assert.equal(mapped.length, 0);
		assert.equal(unresolved.length, 1);
		assert.equal(unresolved[0].partPath, "2");
	});

	// We must not route a PDF attachment into a `text/html` slot via the
	// new relaxed paths. text/html keeps the strict-type contract.
	it("text/html row still requires content-type match — does NOT accept a PDF by filename", () => {
		const parts: LeafInput[] = [
			{
				partPath: "1",
				isMultipart: false,
				mediaType: "TEXT",
				mediaSubtype: "html",
				contentId: undefined,
				dispositionFilename: "report.pdf",
				disposition: "attachment",
			},
		];

		const parsed = buildParsed({
			// No parsed.html; only a PDF attachment with the same filename.
			attachments: [
				buildAttachment({
					content: Buffer.from("%PDF-1.4"),
					contentType: "application/pdf",
					filename: "report.pdf",
				}),
			],
		});

		const { mapped, unresolved } = mapBodyPartsToContent(parts, parsed);
		// The text/html → parsed.html slot wasn't filled (parsed.html is
		// false); the row matches no attachment because the relaxed
		// filename-fallback is only triggered when the strict-type path is
		// not text/html. Actually our impl does match by filename for any
		// type — the safer contract here is that text/html should never
		// pick up a PDF. So we expect unresolved.
		//
		// In the current impl, the filename-equality fallback would match
		// the PDF. That's the bug this assertion guards. We must keep this
		// path strict-only for text/html.
		assert.equal(mapped.length, 0);
		assert.equal(unresolved.length, 1);
	});
});
