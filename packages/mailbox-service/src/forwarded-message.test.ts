import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	mapMessagePartsToContent,
	parsePartSource,
} from "./body-part-mapper.js";
import { type MimeNode, walkMimeStructure } from "./mime-walker.js";

const FIXTURE = readFileSync(
	resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../e2e/fixtures/mime-adversarial/04-forwarded-rfc822-with-attachments.eml",
	),
	"utf8",
).replace(/\r?\n/g, "\r\n");

const ATTACHED = 'Content-Disposition: attachment; filename="forwarded.eml"';
const INLINE = 'Content-Disposition: inline; filename="forwarded.eml"';

/** Fixture 04 as imapflow hands it over: the forwarded message's root reuses part "2". */
const structure = (disposition: string): MimeNode => ({
	type: "multipart/mixed",
	childNodes: [
		{ part: "1", type: "text/plain", encoding: "7bit", size: 115 },
		{
			part: "2",
			type: "message/rfc822",
			encoding: "7bit",
			size: 638,
			disposition,
			dispositionParameters: { filename: "forwarded.eml" },
			childNodes: [
				{
					part: "2",
					type: "multipart/mixed",
					childNodes: [
						{ part: "2.1", type: "text/plain", encoding: "7bit", size: 40 },
						{
							part: "2.2",
							type: "application/pdf",
							encoding: "base64",
							size: 44,
							disposition: "attachment",
							dispositionParameters: { filename: "original.pdf" },
						},
					],
				},
			],
		},
	],
});

const forwardedSource = (): string => {
	const start = FIXTURE.indexOf("From: carol@example.com");
	const end = FIXTURE.indexOf("\r\n--=_adv04_outer_=--");
	return FIXTURE.slice(start, end);
};

const storedContent = async (
	source: string,
	disposition: string,
): Promise<Map<string, string>> => {
	const pairs = await mapMessagePartsToContent(
		walkMimeStructure(structure(disposition)),
		await parsePartSource(Buffer.from(source)),
	);
	return new Map(
		pairs.map((pair) => [pair.partPath, pair.content.toString("utf8")]),
	);
};

describe("a forwarded message/rfc822 part", () => {
	it("is stored as its own part, apart from the message it carries", () => {
		const records = walkMimeStructure(structure("attachment"));

		assert.deepEqual(
			records.map((record) => [
				record.partPath,
				record.parentPartPath,
				`${record.mediaType}/${record.mediaSubtype}`,
			]),
			[
				["0", null, "MULTIPART/mixed"],
				["1", "0", "TEXT/plain"],
				["2", "0", "MESSAGE/rfc822"],
				["2.0", "2", "MULTIPART/mixed"],
				["2.1", "2.0", "TEXT/plain"],
				["2.2", "2.0", "APPLICATION/pdf"],
			],
		);
		const forwarded = records.find((record) => record.partPath === "2");
		assert.equal(forwarded?.isMultipart, false);
		assert.equal(forwarded?.dispositionFilename, "forwarded.eml");
	});

	for (const [disposition, header] of [
		["attachment", ATTACHED],
		["inline", INLINE],
	] as const) {
		it(`stores the raw forwarded message and its own parts' bytes when it is ${disposition}`, async () => {
			const content = await storedContent(
				FIXTURE.replace(ATTACHED, header),
				disposition,
			);

			assert.deepEqual([...content.keys()], ["1", "2", "2.1", "2.2"]);
			assert.match(content.get("1") ?? "", /Forwarding the message below/);
			assert.equal(
				(content.get("2") ?? "").trimEnd(),
				forwardedSource().trimEnd(),
			);
			assert.equal(
				(content.get("2.1") ?? "").trimEnd(),
				"Original message body before forwarding.",
			);
			assert.equal(content.get("2.2"), "%PDF-1.4\n%adv 04 inner pdf\n%EOF\n");
		});
	}
});
