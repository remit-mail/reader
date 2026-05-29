/**
 * One-shot baseline generator for the body-part-mapper fixture corpus.
 *
 * Reads every `.eml` + `.bodyparts.json` pair in this directory, runs
 * `mapBodyPartsToContent`, and writes the result to `.expected.json`.
 *
 * Usage: `npx tsx packages/remit-mailbox-service/test/fixtures/mime/_generate-baselines.ts`
 *
 * Not part of the test suite — invoked manually when fixtures change or the
 * mapper output legitimately moves. Kept here so the regeneration step is
 * reproducible.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BodyPartItem } from "@remit/remit-electrodb-service";
import { simpleParser } from "mailparser";
import { mapBodyPartsToContent } from "../../../src/body-part-mapper.js";

type MapperInput = Pick<
	BodyPartItem,
	| "partPath"
	| "isMultipart"
	| "mediaType"
	| "mediaSubtype"
	| "contentId"
	| "dispositionFilename"
	| "disposition"
> & { sizeOctets?: number };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sha256 = (buf: Buffer): string =>
	createHash("sha256").update(buf).digest("hex");

interface ExpectedPair {
	partPath: string;
	contentType: string;
	contentSha256: string;
	contentLength: number;
}

const main = async (): Promise<void> => {
	const emls = readdirSync(__dirname)
		.filter((n) => n.endsWith(".eml"))
		.sort();

	for (const emlName of emls) {
		const basename = emlName.replace(/\.eml$/, "");
		const emlPath = join(__dirname, emlName);
		const bodyPartsPath = join(__dirname, `${basename}.bodyparts.json`);
		const expectedPath = join(__dirname, `${basename}.expected.json`);

		if (!existsSync(bodyPartsPath)) {
			console.warn(`skip ${basename}: no .bodyparts.json`);
			continue;
		}

		const eml = readFileSync(emlPath);
		const parsed = await simpleParser(eml);
		const rawParts = JSON.parse(readFileSync(bodyPartsPath, "utf8")) as Array<{
			partPath: string;
			isMultipart: boolean;
			mediaType: string;
			mediaSubtype: string;
			contentId?: string | null;
			dispositionFilename?: string | null;
			disposition?: "inline" | "attachment" | null;
			sizeOctets?: number | null;
		}>;
		const bodyParts = rawParts.map((p) => ({
			partPath: p.partPath,
			isMultipart: p.isMultipart,
			mediaType: p.mediaType as MapperInput["mediaType"],
			mediaSubtype: p.mediaSubtype,
			contentId: p.contentId == null ? undefined : p.contentId,
			dispositionFilename:
				p.dispositionFilename == null ? undefined : p.dispositionFilename,
			disposition: p.disposition == null ? undefined : p.disposition,
			sizeOctets: p.sizeOctets == null ? undefined : p.sizeOctets,
		})) as MapperInput[];

		const result = mapBodyPartsToContent(bodyParts, parsed);

		const pairs: ExpectedPair[] = result.map((m) => ({
			partPath: m.partPath,
			contentType: m.contentType,
			contentSha256: sha256(m.content),
			contentLength: m.content.length,
		}));
		pairs.sort((a, b) => a.partPath.localeCompare(b.partPath));

		writeFileSync(expectedPath, `${JSON.stringify({ pairs }, null, 2)}\n`);
		console.log(`wrote ${basename}.expected.json (${pairs.length} pairs)`);
	}
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
