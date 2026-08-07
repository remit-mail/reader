import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapBodyPartResponse } from "@remit/api-http-client/types.gen.ts";
import { selectMessageAttachments } from "./message-attachments";

const part = (
	overrides: Partial<RemitImapBodyPartResponse>,
): RemitImapBodyPartResponse =>
	({
		bodyPartId: "part-1",
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
});
