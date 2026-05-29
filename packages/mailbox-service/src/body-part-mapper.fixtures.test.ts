/**
 * Fixture-driven assertion harness for `mapBodyPartsToContent`.
 *
 * Discovers every `.eml` file under `test/fixtures/mime/`, parses it with
 * `simpleParser`, loads a sibling `.bodyparts.json` that hand-codes the
 * `BodyPart` rows the mime-walker would emit for that message, runs the
 * mapper, and asserts the resulting pairs against the sibling
 * `.expected.json` baseline.
 *
 * Design choice: option (b) per the issue #395 PR A brief.
 *
 * We hand-write `.bodyparts.json` next to each `.eml` rather than parsing the
 * `.eml` into an `ImapBodyStructure` and running `walkMimeStructure` against
 * it. Reasoning:
 *   - imapflow's `tools.parseBodystructure` consumes an IMAP wire-format
 *     attribute tree, not a raw `.eml`; there is no convenient `.eml` -> tree
 *     parser shipped with the package.
 *   - mailparser walks the tree internally but only exposes leaves via
 *     `attachments[].partId` (and `text`/`html` aggregates); reconstructing
 *     the multipart container rows from that output is more brittle than
 *     restating them by hand.
 *   - Each fixture is small (1-7 leaves) and the BodyPart shape we need
 *     (`MapperInput`) is six fields. Hand-coding is cheaper than building a
 *     parser, and it keeps the harness decoupled from `mime-walker`'s
 *     behaviour — when PR B rewrites the mapper, only the mapper's output is
 *     in scope.
 *
 * Baselines: each `.expected.json` records the pairing the (now total)
 * mapper produces. Every non-multipart leaf has a pair — `contentSha256` and
 * `contentLength` are always concrete; there are no `skipped` markers.
 * Regenerate via `npx tsx test/fixtures/mime/_generate-baselines.ts`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { BodyPartItem } from "@remit/remit-electrodb-service";
import { simpleParser } from "mailparser";
import { mapBodyPartsToContent } from "./body-part-mapper.js";

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

interface ExpectedPair {
	partPath: string;
	contentType: string;
	contentSha256: string;
	contentLength: number;
}

interface ExpectedFile {
	pairs: ExpectedPair[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, "../test/fixtures/mime");

const sha256 = (buf: Buffer): string =>
	createHash("sha256").update(buf).digest("hex");

const listEmlFixtures = (): string[] =>
	readdirSync(FIXTURES_DIR)
		.filter((name) => name.endsWith(".eml"))
		.sort();

interface RawBodyPart {
	partPath: string;
	isMultipart: boolean;
	mediaType: string;
	mediaSubtype: string;
	contentId?: string | null;
	dispositionFilename?: string | null;
	disposition?: "inline" | "attachment" | null;
	sizeOctets?: number | null;
}

const nullToUndef = <T>(v: T | null | undefined): T | undefined =>
	v == null ? undefined : v;

const loadBodyParts = (basename: string): MapperInput[] => {
	const path = join(FIXTURES_DIR, `${basename}.bodyparts.json`);
	const raw = readFileSync(path, "utf8");
	const parts = JSON.parse(raw) as RawBodyPart[];
	return parts.map((p) => ({
		partPath: p.partPath,
		isMultipart: p.isMultipart,
		mediaType: p.mediaType as MapperInput["mediaType"],
		mediaSubtype: p.mediaSubtype,
		contentId: nullToUndef(p.contentId),
		dispositionFilename: nullToUndef(p.dispositionFilename),
		disposition: nullToUndef(p.disposition),
		sizeOctets: nullToUndef(p.sizeOctets),
	})) as MapperInput[];
};

const loadExpected = (basename: string): ExpectedFile => {
	const path = join(FIXTURES_DIR, `${basename}.expected.json`);
	const raw = readFileSync(path, "utf8");
	return JSON.parse(raw) as ExpectedFile;
};

describe("mapBodyPartsToContent fixture corpus", () => {
	const fixtures = listEmlFixtures();
	assert.ok(fixtures.length > 0, "expected at least one .eml fixture");

	for (const emlName of fixtures) {
		const basename = emlName.replace(/\.eml$/, "");
		it(`pairs match baseline for ${basename}`, async () => {
			const eml = readFileSync(join(FIXTURES_DIR, emlName));
			const parsed = await simpleParser(eml);
			const bodyParts = loadBodyParts(basename);
			const expected = loadExpected(basename);

			const pairs = mapBodyPartsToContent(bodyParts, parsed);

			// Build an actual-pair lookup keyed by partPath.
			const actualByPath = new Map<
				string,
				{
					contentType: string;
					contentSha256: string;
					contentLength: number;
				}
			>();

			for (const p of pairs) {
				actualByPath.set(p.partPath, {
					contentType: p.contentType,
					contentSha256: sha256(p.content),
					contentLength: p.content.length,
				});
			}

			// Totality: one pair per non-multipart leaf.
			const leafCount = bodyParts.filter((bp) => !bp.isMultipart).length;
			assert.equal(
				pairs.length,
				leafCount,
				`mapper must be total for ${basename}: pairs=${pairs.length} leaves=${leafCount}`,
			);

			// Every expected pair must be present and match exactly.
			for (const exp of expected.pairs) {
				const actual = actualByPath.get(exp.partPath);
				assert.ok(
					actual,
					`expected a pair for partPath="${exp.partPath}" in ${basename}, got none`,
				);
				assert.equal(
					actual.contentType,
					exp.contentType,
					`contentType mismatch for ${basename} partPath=${exp.partPath}`,
				);
				assert.equal(
					actual.contentLength,
					exp.contentLength,
					`contentLength mismatch for ${basename} partPath=${exp.partPath}`,
				);
				assert.equal(
					actual.contentSha256,
					exp.contentSha256,
					`contentSha256 mismatch for ${basename} partPath=${exp.partPath}`,
				);
			}

			// And no unexpected extras — the baseline is exhaustive per fixture.
			assert.equal(
				actualByPath.size,
				expected.pairs.length,
				`pair count mismatch for ${basename}: actual=${actualByPath.size} expected=${expected.pairs.length}`,
			);
		});
	}
});
