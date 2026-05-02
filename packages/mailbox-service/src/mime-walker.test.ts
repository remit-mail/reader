import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type MimeNode,
	ROOT_PART_PATH,
	walkMimeStructure,
} from "./mime-walker.js";

describe("walkMimeStructure", () => {
	it("flattens a simple text/plain message into a single record", () => {
		const root: MimeNode = {
			type: "text/plain",
			parameters: { charset: "utf-8" },
			encoding: "7bit",
			size: 42,
			lineCount: 3,
		};

		const records = walkMimeStructure(root);

		assert.equal(records.length, 1);
		const [only] = records;
		assert.equal(only.partPath, ROOT_PART_PATH);
		assert.equal(only.parentPartPath, null);
		assert.equal(only.mediaType, "TEXT");
		assert.equal(only.mediaSubtype, "plain");
		assert.equal(only.transferEncoding, "7BIT");
		assert.equal(only.sizeOctets, 42);
		assert.equal(only.lineCount, 3);
		assert.equal(only.isMultipart, false);
		assert.equal(only.disposition, undefined);
		assert.deepEqual(only.parameters, [
			{ parameterName: "charset", parameterValue: "utf-8" },
		]);
	});

	it("walks multipart/alternative + multipart/mixed + attachment + inline image (alice/bob fixture)", () => {
		// multipart/mixed
		//   ├── multipart/alternative   (1)
		//   │     ├── text/plain        (1.1)
		//   │     └── text/html         (1.2)
		//   ├── application/pdf  (attachment)  (2)
		//   └── multipart/related        (3)
		//         ├── text/html          (3.1)
		//         └── image/png  (inline) (3.2)
		const root: MimeNode = {
			type: "multipart/mixed",
			parameters: { boundary: "outer" },
			childNodes: [
				{
					part: "1",
					type: "multipart/alternative",
					parameters: { boundary: "alt" },
					childNodes: [
						{
							part: "1.1",
							type: "text/plain",
							parameters: { charset: "utf-8" },
							encoding: "7bit",
							size: 120,
							lineCount: 4,
						},
						{
							part: "1.2",
							type: "text/html",
							parameters: { charset: "utf-8" },
							encoding: "quoted-printable",
							size: 350,
							lineCount: 6,
						},
					],
				},
				{
					part: "2",
					type: "application/pdf",
					parameters: { name: "alice-resume.pdf" },
					encoding: "base64",
					size: 9001,
					disposition: "attachment",
					dispositionParameters: { filename: "alice-resume.pdf" },
					md5: "deadbeef",
				},
				{
					part: "3",
					type: "multipart/related",
					parameters: { boundary: "rel" },
					childNodes: [
						{
							part: "3.1",
							type: "text/html",
							parameters: { charset: "utf-8" },
							encoding: "quoted-printable",
							size: 200,
							lineCount: 5,
						},
						{
							part: "3.2",
							type: "image/png",
							parameters: { name: "bob-avatar.png" },
							id: "<bob-avatar@example.com>",
							encoding: "base64",
							size: 4096,
							disposition: "inline",
							dispositionParameters: { filename: "bob-avatar.png" },
						},
					],
				},
			],
		};

		const records = walkMimeStructure(root);

		const byPath = new Map(records.map((r) => [r.partPath, r]));

		assert.equal(records.length, 8);

		const rootRec = byPath.get(ROOT_PART_PATH);
		assert.ok(rootRec, "root present");
		assert.equal(rootRec.parentPartPath, null);
		assert.equal(rootRec.isMultipart, true);
		assert.equal(rootRec.mediaType, "MULTIPART");
		assert.equal(rootRec.mediaSubtype, "mixed");
		assert.equal(rootRec.multipartSubtype, "mixed");

		const alt = byPath.get("1");
		assert.ok(alt);
		assert.equal(alt.parentPartPath, ROOT_PART_PATH);
		assert.equal(alt.isMultipart, true);
		assert.equal(alt.multipartSubtype, "alternative");

		const text = byPath.get("1.1");
		assert.ok(text);
		assert.equal(text.parentPartPath, "1");
		assert.equal(text.mediaType, "TEXT");
		assert.equal(text.mediaSubtype, "plain");
		assert.equal(text.transferEncoding, "7BIT");

		const html = byPath.get("1.2");
		assert.ok(html);
		assert.equal(html.parentPartPath, "1");
		assert.equal(html.transferEncoding, "QUOTED-PRINTABLE");

		const pdf = byPath.get("2");
		assert.ok(pdf);
		assert.equal(pdf.parentPartPath, ROOT_PART_PATH);
		assert.equal(pdf.mediaType, "APPLICATION");
		assert.equal(pdf.disposition, "attachment");
		assert.equal(pdf.dispositionFilename, "alice-resume.pdf");
		assert.equal(pdf.md5Hash, "deadbeef");
		assert.equal(pdf.sizeOctets, 9001);

		const related = byPath.get("3");
		assert.ok(related);
		assert.equal(related.multipartSubtype, "related");

		const inlineImg = byPath.get("3.2");
		assert.ok(inlineImg);
		assert.equal(inlineImg.parentPartPath, "3");
		assert.equal(inlineImg.disposition, "inline");
		assert.equal(inlineImg.contentId, "bob-avatar@example.com");
		assert.equal(inlineImg.dispositionFilename, "bob-avatar.png");
	});

	it("falls back to Content-Type 'name' parameter when no Content-Disposition filename is set", () => {
		const root: MimeNode = {
			type: "application/octet-stream",
			parameters: { name: "alice-data.bin" },
			encoding: "base64",
			size: 100,
			disposition: "attachment",
		};

		const [rec] = walkMimeStructure(root);
		assert.equal(rec.dispositionFilename, "alice-data.bin");
	});

	it("emits stable, sorted parameters (no input-order dependence)", () => {
		const root: MimeNode = {
			type: "text/plain",
			parameters: { charset: "utf-8", format: "flowed", name: "alice.txt" },
			encoding: "7bit",
			size: 1,
		};

		const [rec] = walkMimeStructure(root);
		assert.deepEqual(
			rec.parameters.map((p) => p.parameterName),
			["charset", "format", "name"],
		);
	});

	it("throws on an unknown MIME top-level type", () => {
		assert.throws(
			() =>
				walkMimeStructure({
					type: "carrierpigeon/scroll",
					encoding: "7bit",
					size: 1,
				}),
			/unknown MIME top-level type/,
		);
	});

	it("throws on a Content-Type with no '/' separator", () => {
		assert.throws(
			() =>
				walkMimeStructure({
					type: "text",
					encoding: "7bit",
					size: 1,
				}),
			/malformed Content-Type/,
		);
	});

	it("throws on a Content-Type missing the subtype", () => {
		assert.throws(
			() =>
				walkMimeStructure({
					type: "text/",
					encoding: "7bit",
					size: 1,
				}),
			/missing MIME subtype/,
		);
	});

	it("throws on an unknown transfer encoding (no silent fallback)", () => {
		assert.throws(
			() =>
				walkMimeStructure({
					type: "text/plain",
					encoding: "rot13",
					size: 1,
				}),
			/unknown transfer encoding/,
		);
	});

	it("throws on an unknown Content-Disposition", () => {
		assert.throws(
			() =>
				walkMimeStructure({
					type: "application/pdf",
					encoding: "base64",
					size: 1,
					disposition: "secretly-mine",
				}),
			/unknown Content-Disposition/,
		);
	});

	it("defaults transferEncoding to 7BIT and sizeOctets to 0 when absent", () => {
		const [rec] = walkMimeStructure({ type: "text/plain" });
		assert.equal(rec.transferEncoding, "7BIT");
		assert.equal(rec.sizeOctets, 0);
	});
});
