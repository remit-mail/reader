import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapBodyPartResponse } from "@remit/api-http-client/types.gen.ts";
import { selectMessageAttachments } from "./message-attachments";

const part = (
	overrides: Partial<RemitImapBodyPartResponse>,
): RemitImapBodyPartResponse =>
	({
		bodyPartId: "part-1",
		partPath: "2",
		mediaType: "APPLICATION",
		mediaSubtype: "PDF",
		sizeOctets: 2048,
		disposition: "attachment",
		dispositionFilename: "report.pdf",
		contentUrl: "https://cdn.test/content/parts/2",
		isMultipart: false,
		...overrides,
	}) as RemitImapBodyPartResponse;

describe("selectMessageAttachments", () => {
	it("keeps only attachment-disposition leaves", () => {
		const parts = [
			part({ bodyPartId: "body", disposition: "inline", mediaSubtype: "HTML" }),
			part({ bodyPartId: "container", isMultipart: true }),
			part({ bodyPartId: "file" }),
		];
		assert.deepEqual(
			selectMessageAttachments(parts).map((a) => a.bodyPartId),
			["file"],
		);
	});

	it("drops a part with no content URL to fetch", () => {
		assert.deepEqual(selectMessageAttachments([part({ contentUrl: "" })]), []);
	});

	it("preserves the order the message declares", () => {
		const parts = [
			part({ bodyPartId: "a", dispositionFilename: "a.pdf" }),
			part({ bodyPartId: "b", dispositionFilename: "b.pdf" }),
		];
		assert.deepEqual(
			selectMessageAttachments(parts).map((a) => a.filename),
			["a.pdf", "b.pdf"],
		);
	});

	it("carries filename, size and content URL through", () => {
		const [attachment] = selectMessageAttachments([
			part({ sizeOctets: 4096, contentUrl: "https://cdn.test/x" }),
		]);
		assert.equal(attachment.filename, "report.pdf");
		assert.equal(attachment.typeLabel, "PDF");
		assert.equal(attachment.sizeOctets, 4096);
		assert.equal(attachment.contentUrl, "https://cdn.test/x");
	});

	it("sanitizes a filename that tries to escape the download directory", () => {
		const [attachment] = selectMessageAttachments([
			part({ dispositionFilename: "../../../etc/passwd" }),
		]);
		assert.equal(attachment.filename, "passwd");
	});

	it("names an unnamed attachment after its subtype", () => {
		const [attachment] = selectMessageAttachments([
			part({ dispositionFilename: undefined }),
		]);
		assert.equal(attachment.filename, "attachment.pdf");
	});

	it("falls back to a bare name when the subtype yields no extension", () => {
		const [attachment] = selectMessageAttachments([
			part({ dispositionFilename: undefined, mediaSubtype: "-" }),
		]);
		assert.equal(attachment.filename, "attachment");
	});

	it("labels an undifferentiated binary as a file rather than as its subtype", () => {
		const [attachment] = selectMessageAttachments([
			part({ mediaSubtype: "OCTET-STREAM" }),
		]);
		assert.equal(attachment.typeLabel, "FILE");
	});

	describe("a forwarded message", () => {
		const forwarded = part({
			bodyPartId: "forwarded",
			partPath: "2",
			mediaType: "MESSAGE",
			mediaSubtype: "rfc822",
			dispositionFilename: "forwarded.eml",
		});
		const inner = [
			part({
				bodyPartId: "inner-root",
				partPath: "2.0",
				mediaType: "MULTIPART",
				mediaSubtype: "mixed",
				isMultipart: true,
				disposition: undefined,
			}),
			part({
				bodyPartId: "inner-text",
				partPath: "2.1",
				mediaType: "TEXT",
				mediaSubtype: "plain",
				disposition: undefined,
			}),
			part({
				bodyPartId: "inner-pdf",
				partPath: "2.2",
				dispositionFilename: "original.pdf",
			}),
		];

		it("is listed as a message, and the attachment inside it is not", () => {
			const attachments = selectMessageAttachments([
				forwarded,
				...inner,
				part({ bodyPartId: "outer-pdf", partPath: "3" }),
			]);
			assert.deepEqual(
				attachments.map((a) => [a.bodyPartId, a.kind, a.filename]),
				[
					["forwarded", "message", "forwarded.eml"],
					["outer-pdf", "file", "report.pdf"],
				],
			);
		});

		it("is listed whatever disposition the sender gave it", () => {
			const [attachment] = selectMessageAttachments([
				{ ...forwarded, disposition: undefined },
			]);
			assert.equal(attachment?.kind, "message");
			assert.equal(attachment?.filename, "forwarded.eml");
			assert.equal(attachment?.typeLabel, "MESSAGE");
		});

		it("lists its own attachment once it is the message being read", () => {
			assert.deepEqual(
				selectMessageAttachments(inner).map((a) => a.bodyPartId),
				["inner-pdf"],
			);
		});

		it("is not confused with a delivery report", () => {
			assert.deepEqual(
				selectMessageAttachments([
					part({
						mediaType: "MESSAGE",
						mediaSubtype: "delivery-status",
						disposition: undefined,
					}),
				]),
				[],
			);
		});
	});
});
