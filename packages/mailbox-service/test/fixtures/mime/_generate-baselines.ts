/**
 * One-shot baseline generator for the body-part-mapper fixture corpus.
 *
 * Reads every `.eml` + `.bodyparts.json` pair in this directory, runs the
 * CURRENT `mapBodyPartsToContent`, and writes the result to `.expected.json`.
 * Preserves any pre-existing `_fixmes` array on each expected file so the
 * checklist for PR B survives regenerations.
 *
 * Usage: `npx tsx packages/remit-mailbox-service/test/fixtures/mime/_generate-baselines.ts`
 *
 * Not part of the test suite — invoked manually by the author of PR A and
 * (later) by PR B when it updates the baselines to reflect the redesigned
 * mapper's output. Kept here so the regeneration step is reproducible.
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
>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sha256 = (buf: Buffer): string =>
	createHash("sha256").update(buf).digest("hex");

interface ExpectedPair {
	partPath: string;
	contentType: string;
	contentSha256: string | null;
	contentLength: number;
	skipped?: boolean;
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
		})) as MapperInput[];

		const { mapped, unresolved } = mapBodyPartsToContent(bodyParts, parsed);

		const pairs: ExpectedPair[] = [];
		for (const m of mapped) {
			pairs.push({
				partPath: m.partPath,
				contentType: m.contentType,
				contentSha256: sha256(m.content),
				contentLength: m.content.length,
			});
		}
		for (const u of unresolved) {
			pairs.push({
				partPath: u.partPath,
				contentType: u.contentType,
				contentSha256: null,
				contentLength: 0,
				skipped: true,
			});
		}
		pairs.sort((a, b) => a.partPath.localeCompare(b.partPath));

		let fixmes: string[] | undefined;
		if (existsSync(expectedPath)) {
			try {
				const prev = JSON.parse(readFileSync(expectedPath, "utf8")) as {
					_fixmes?: string[];
				};
				if (Array.isArray(prev._fixmes) && prev._fixmes.length > 0) {
					fixmes = prev._fixmes;
				}
			} catch {
				// ignore — we'll overwrite.
			}
		}

		const out: { pairs: ExpectedPair[]; _fixmes?: string[] } = { pairs };
		if (fixmes) out._fixmes = fixmes;

		writeFileSync(expectedPath, `${JSON.stringify(out, null, 2)}\n`);
		console.log(
			`wrote ${basename}.expected.json (${mapped.length} mapped, ${unresolved.length} unresolved${
				fixmes ? `, ${fixmes.length} fixmes` : ""
			})`,
		);
	}
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
