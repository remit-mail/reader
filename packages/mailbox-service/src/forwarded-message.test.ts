import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { simpleParser } from "mailparser";
import { mapMessagePartsToContent } from "./body-part-mapper.js";
import { type MimeNode, walkMimeStructure } from "./mime-walker.js";

const require = createRequire(import.meta.url);
const parseImapResponse: (
	line: Buffer,
) => Promise<unknown> = require("imapflow/lib/handler/imap-parser");
const imapflowTools: {
	formatMessageResponse: (
		untagged: unknown,
		mailbox: object,
	) => Promise<{ bodyStructure: MimeNode }>;
} = require("imapflow/lib/tools");

const FIXTURE = readFileSync(
	resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../e2e/fixtures/mime-adversarial/04-forwarded-rfc822-with-attachments.eml",
	),
	"utf8",
).replace(/\r?\n/g, "\r\n");

const FORWARDED_DISPOSITION = '("attachment" ("filename" "forwarded.eml"))';

/** The BODYSTRUCTURE Dovecot returns for adversarial fixture 04. */
const BODYSTRUCTURE = `* 1 FETCH (BODYSTRUCTURE (("text" "plain" ("charset" "us-ascii") NIL NIL "7bit" 115 4 NIL NIL NIL NIL)("message" "rfc822" NIL NIL NIL "7bit" 638 ("Thu, 28 May 2026 12:00:00 +0000" "Original message with attachment for fixture 04" ((NIL NIL "carol" "example.com")) ((NIL NIL "carol" "example.com")) ((NIL NIL "carol" "example.com")) ((NIL NIL "alice" "example.com")) NIL NIL NIL "<adv-04-inner@example.com>") (("text" "plain" ("charset" "us-ascii") NIL NIL "7bit" 40 0 NIL NIL NIL NIL)("application" "pdf" ("name" "original.pdf") NIL NIL "base64" 44 NIL ("attachment" ("filename" "original.pdf")) NIL NIL) "mixed" ("boundary" "=_adv04_inner_=") NIL NIL NIL) 20 NIL ${FORWARDED_DISPOSITION} NIL NIL) "mixed" ("boundary" "=_adv04_outer_=") NIL NIL NIL))`;

const structureOf = async (line: string): Promise<MimeNode> => {
	const untagged = await parseImapResponse(Buffer.from(line));
	const { bodyStructure } = await imapflowTools.formatMessageResponse(
		untagged,
		{},
	);
	return bodyStructure;
};

const forwardedSource = (): string => {
	const start = FIXTURE.indexOf("From: carol@example.com");
	const end = FIXTURE.indexOf("\r\n--=_adv04_outer_=--");
	return FIXTURE.slice(start, end);
};

describe("a forwarded message/rfc822 part", () => {
	it("is stored as its own part, apart from the message it carries", async () => {
		const records = walkMimeStructure(await structureOf(BODYSTRUCTURE));

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
		assert.equal(forwarded?.disposition, "attachment");
		assert.equal(forwarded?.dispositionFilename, "forwarded.eml");
	});

	it("is named after the subject it carries when it declares no filename", async () => {
		const records = walkMimeStructure(
			await structureOf(BODYSTRUCTURE.replace(FORWARDED_DISPOSITION, "NIL")),
		);

		assert.equal(
			records.find((record) => record.partPath === "2")?.dispositionFilename,
			"Original message with attachment for fixture 04.eml",
		);
	});

	it("stores the raw forwarded message, and its own parts' bytes under it", async () => {
		const records = walkMimeStructure(await structureOf(BODYSTRUCTURE));
		const pairs = await mapMessagePartsToContent(
			records,
			await simpleParser(FIXTURE),
		);
		const content = (partPath: string): string =>
			pairs
				.find((pair) => pair.partPath === partPath)
				?.content.toString("utf8") ?? "";

		assert.deepEqual(
			pairs.map((pair) => pair.partPath),
			["1", "2", "2.1", "2.2"],
		);
		assert.match(content("1"), /Forwarding the message below/);
		assert.equal(content("2").trimEnd(), forwardedSource().trimEnd());
		assert.equal(
			content("2.1").trimEnd(),
			"Original message body before forwarding.",
		);
		assert.equal(content("2.2"), "%PDF-1.4\n%adv 04 inner pdf\n%EOF\n");
	});
});
