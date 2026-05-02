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
			},
			{
				partPath: "1",
				isMultipart: false,
				mediaType: "TEXT",
				mediaSubtype: "plain",
				contentId: undefined,
				dispositionFilename: undefined,
			},
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "TEXT",
				mediaSubtype: "html",
				contentId: undefined,
				dispositionFilename: undefined,
			},
		];

		const parsed = buildParsed({
			text: "hello alice",
			html: "<p>hello bob</p>",
		});

		const result = mapBodyPartsToContent(parts, parsed);

		assert.equal(result.length, 2);
		assert.equal(result[0].partPath, "1");
		assert.equal(result[0].contentType, "text/plain");
		assert.equal(result[0].content.toString("utf8"), "hello alice");
		assert.equal(result[1].partPath, "2");
		assert.equal(result[1].contentType, "text/html");
		assert.equal(result[1].content.toString("utf8"), "<p>hello bob</p>");
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
			},
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "IMAGE",
				mediaSubtype: "png",
				contentId: "<bob-avatar@example.com>",
				dispositionFilename: "bob-avatar.png",
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

		const result = mapBodyPartsToContent(parts, parsed);

		assert.equal(result.length, 2);
		const img = result.find((r) => r.partPath === "2");
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

		const [only] = mapBodyPartsToContent(parts, parsed);
		assert.equal(only.partPath, "1");
		assert.deepEqual(only.content, pdfBytes);
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
			},
			{
				partPath: "2",
				isMultipart: false,
				mediaType: "APPLICATION",
				mediaSubtype: "pdf",
				contentId: undefined,
				dispositionFilename: undefined,
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

		const result = mapBodyPartsToContent(parts, parsed);
		assert.deepEqual(result[0].content, a);
		assert.deepEqual(result[1].content, b);
	});

	it("throws (does not silently skip) when a leaf has no matching parsed content", () => {
		const parts: LeafInput[] = [
			{
				partPath: "5",
				isMultipart: false,
				mediaType: "IMAGE",
				mediaSubtype: "png",
				contentId: "<missing@example.com>",
				dispositionFilename: undefined,
			},
		];

		const parsed = buildParsed({});

		assert.throws(
			() => mapBodyPartsToContent(parts, parsed),
			/no parsed-mail content for partPath="5"/,
		);
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
			},
		];
		const parsed = buildParsed({});
		const result = mapBodyPartsToContent(parts, parsed);
		assert.deepEqual(result, []);
	});
});
