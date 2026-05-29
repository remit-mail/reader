/**
 * Property test for the total body-part mapper (issue #395 PR C).
 *
 * Generates 10,000 random MIME trees (depth ≤ 4, mixed/alternative/related
 * multiparts, five leaf content types, optional filenames/contentIds,
 * occasional empty leaves), renders each to an `.eml`, parses it via
 * `simpleParser`, walks the synthetic tree into `MapperInput[]`, and runs
 * `mapBodyPartsToContent`.
 *
 * Per-iteration assertions:
 *   1. Totality        — `pairs.length === leafCount`.
 *   2. Buffer-ness     — every `pair.content` is a Buffer (never undefined/null).
 *   3. No-throw        — wrapping the call site never escapes.
 *   4. PartPath cover  — every leaf's `partPath` appears exactly once in `pairs`.
 *
 * Reproducibility: seed via `MAPPER_PROPERTY_SEED` env var. Defaults to
 * `0xC0DEC0DE` so CI runs are deterministic. The generator's per-iteration
 * RNG is derived from `(baseSeed ^ iterationIndex)` so a failure on
 * iteration `N` can be reproduced as a single-iteration run with the same
 * combined seed.
 *
 * Targeted property blocks below cover PR B reviewer's three gaps:
 *   - Case-insensitive `dispositionFilename` matching.
 *   - Negative routing: `application/octet-stream` without a filename
 *     doesn't swallow a text/html attachment.
 *   - Inline `cid:` casing + angle-bracket insensitivity.
 */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import { simpleParser } from "mailparser";
import { type MapperInput, mapBodyPartsToContent } from "./body-part-mapper.js";
import {
	createRng,
	generateMimeTree,
	type MultipartNode,
	renderEml,
	treeToBodyParts,
} from "./test-helpers/mime-tree-generator.js";

const DEFAULT_SEED = 0xc0dec0de;
const ITERATIONS = 10_000;

const parseSeed = (): number => {
	const raw = process.env.MAPPER_PROPERTY_SEED;
	if (!raw) return DEFAULT_SEED;
	const n = Number.parseInt(raw, 10);
	if (Number.isNaN(n)) {
		throw new Error(
			`MAPPER_PROPERTY_SEED is not a valid integer: ${JSON.stringify(raw)}`,
		);
	}
	return n | 0;
};

const collectLeafPaths = (parts: readonly MapperInput[]): string[] =>
	parts.filter((p) => !p.isMultipart).map((p) => p.partPath);

describe("body-part-mapper property: random MIME trees", () => {
	it(`pairs every leaf for ${ITERATIONS} random trees (seed-reproducible)`, async () => {
		const baseSeed = parseSeed();

		for (let i = 0; i < ITERATIONS; i++) {
			const iterSeed = (baseSeed ^ i) | 0;
			const rng = createRng(iterSeed);
			const tree = generateMimeTree(rng);
			const eml = renderEml(tree, { seed: iterSeed });
			const bodyParts = treeToBodyParts(tree);
			const leafPaths = collectLeafPaths(bodyParts);

			let parsed: Awaited<ReturnType<typeof simpleParser>>;
			try {
				parsed = await simpleParser(eml);
			} catch (err) {
				// If mailparser can't parse, the generated EML is bad — surface
				// it loudly with the seed so we can reproduce.
				assert.fail(
					`simpleParser threw for seed=${iterSeed} (iteration ${i}): ${(err as Error).message}`,
				);
				throw err; // unreachable; satisfies the control-flow analysis below.
			}

			// Assertion 3: mapper never throws.
			let pairs: ReturnType<typeof mapBodyPartsToContent>;
			try {
				pairs = mapBodyPartsToContent(bodyParts, parsed);
			} catch (err) {
				assert.fail(
					`mapBodyPartsToContent threw for seed=${iterSeed} (iteration ${i}): ${(err as Error).message}`,
				);
				throw err; // unreachable
			}

			// Assertion 1: totality.
			assert.equal(
				pairs.length,
				leafPaths.length,
				`totality violated for seed=${iterSeed} (iteration ${i}): pairs=${pairs.length} leaves=${leafPaths.length}`,
			);

			// Assertion 2: every content is a Buffer.
			for (const p of pairs) {
				assert.ok(
					Buffer.isBuffer(p.content),
					`pair.content is not a Buffer for seed=${iterSeed} (iteration ${i}), partPath=${p.partPath}`,
				);
			}

			// Assertion 4: every leaf partPath appears exactly once.
			const seen = new Map<string, number>();
			for (const p of pairs)
				seen.set(p.partPath, (seen.get(p.partPath) ?? 0) + 1);
			for (const path of leafPaths) {
				assert.equal(
					seen.get(path),
					1,
					`leaf partPath="${path}" not paired exactly once for seed=${iterSeed} (iteration ${i})`,
				);
			}
		}
	});
});

/* -------------------------------------------------------------------- */
/* Targeted properties: PR B reviewer's three gaps                      */
/* -------------------------------------------------------------------- */

const TARGETED_ITERATIONS = 100;

/**
 * Random-case filename matching. Generates a tree with one html leaf and
 * one PDF attachment whose filename has a random mix of upper/lower-case
 * letters. The BODYSTRUCTURE row records the filename verbatim; mailparser
 * preserves the same string on the attachment. The dispositionFilename
 * fallback must match case-insensitively (PR B's `findByFilename` lowercases
 * both sides). With `partId === partPath` doing structural pairing first
 * this looks easy — but if mailparser ever drifts on partId we want the
 * filename fallback to keep working.
 */
describe("body-part-mapper property: case-insensitive filename match", () => {
	it("pairs a PDF leaf when the filename has random-case extension", async () => {
		const baseSeed = parseSeed() ^ 0xa1a1a1a1;

		for (let i = 0; i < TARGETED_ITERATIONS; i++) {
			const rng = createRng((baseSeed ^ i) | 0);
			const randomCase = (s: string): string =>
				[...s]
					.map((c) => (rng.bool(0.5) ? c.toUpperCase() : c.toLowerCase()))
					.join("");
			const filename = randomCase("invoice.pdf");

			const tree: MultipartNode = {
				kind: "multipart",
				subtype: "mixed",
				children: [
					{
						kind: "leaf",
						contentType: "text/html",
						bytes: Buffer.from("<p>see attached</p>", "utf8"),
					},
					{
						kind: "leaf",
						// BODYSTRUCTURE will declare octet-stream; mailparser sniffs PDF
						// from the filename. Filename-case insensitivity is the
						// load-bearing step.
						contentType: "application/octet-stream",
						bytes: Buffer.from("%PDF-fake-bytes", "utf8"),
						filename,
						disposition: "attachment",
					},
				],
			};

			const seed = (baseSeed ^ i) | 0;
			const eml = renderEml(tree, { seed });
			const bodyParts = treeToBodyParts(tree);
			const parsed = await simpleParser(eml);
			const pairs = mapBodyPartsToContent(bodyParts, parsed);

			assert.equal(pairs.length, 2, `seed=${seed}: expected 2 pairs`);
			const pdfPair = pairs.find((p) => p.partPath === "2");
			assert.ok(pdfPair, `seed=${seed}: missing partPath=2 pair`);
			// PDF bytes (from mailparser's attachment) — must equal the rendered
			// leaf body, not an empty buffer and not the html bytes.
			assert.equal(
				pdfPair.content.toString("utf8"),
				"%PDF-fake-bytes",
				`seed=${seed}: PDF pair bytes mismatch (filename=${filename})`,
			);
		}
	});
});

/**
 * Negative routing: an `application/octet-stream` leaf with no filename
 * must not consume a `text/html` attachment from mailparser. With PR B's
 * mapper, the html leaf is routed via `parsed.html` (text-routing slot)
 * before the octet-stream leaf reaches the non-text pairing pipeline,
 * so the html bytes stay with their proper leaf.
 *
 * Shape: multipart/mixed with [html-leaf, octet-stream-leaf]. The
 * octet-stream has no filename, no contentId — only the positional
 * fallback can pair it. We assert that the octet-stream pair does NOT
 * receive the html body's bytes.
 */
describe("body-part-mapper property: negative routing for octet-stream", () => {
	it("does not pair an unnamed octet-stream leaf with html bytes", async () => {
		const baseSeed = parseSeed() ^ 0xb2b2b2b2;

		for (let i = 0; i < TARGETED_ITERATIONS; i++) {
			const seed = (baseSeed ^ i) | 0;
			const rng = createRng(seed);

			const htmlBody = `<html><body><p>seed-${seed}-${randomTag(rng)}</p></body></html>`;
			const octetBody = `octet-${seed}-${randomTag(rng)}`;

			const tree: MultipartNode = {
				kind: "multipart",
				subtype: "mixed",
				children: [
					{
						kind: "leaf",
						contentType: "text/html",
						bytes: Buffer.from(htmlBody, "utf8"),
					},
					{
						kind: "leaf",
						contentType: "application/octet-stream",
						bytes: Buffer.from(octetBody, "utf8"),
						// no filename, no contentId, no disposition
					},
				],
			};

			const eml = renderEml(tree, { seed });
			const bodyParts = treeToBodyParts(tree);
			const parsed = await simpleParser(eml);
			const pairs = mapBodyPartsToContent(bodyParts, parsed);

			assert.equal(pairs.length, 2, `seed=${seed}: expected 2 pairs`);

			const htmlPair = pairs.find((p) => p.partPath === "1");
			const octetPair = pairs.find((p) => p.partPath === "2");
			assert.ok(htmlPair, `seed=${seed}: missing html pair`);
			assert.ok(octetPair, `seed=${seed}: missing octet pair`);

			// html leaf gets the html body (text-routing slot).
			const htmlStr = htmlPair.content.toString("utf8");
			assert.ok(
				htmlStr.includes(`seed-${seed}-`),
				`seed=${seed}: html pair lost its body (got "${htmlStr.slice(0, 80)}")`,
			);

			// octet leaf must NOT contain the html body's marker.
			const octetStr = octetPair.content.toString("utf8");
			assert.ok(
				!octetStr.includes("<html>"),
				`seed=${seed}: octet pair swallowed html bytes (got "${octetStr.slice(0, 80)}")`,
			);
		}
	});
});

/**
 * Inline `cid:` casing + angle-bracket insensitivity. PR B's
 * `findByContentId` strips angle brackets and lowercases both sides, so a
 * BODYSTRUCTURE row with `contentId: "Logo@Example.ORG"` should still pair
 * with a mailparser attachment whose `cid` is `<logo@example.org>` (or any
 * mixed-case variant with/without brackets). We assert the image leaf
 * receives the image bytes — not the html ones — across random
 * permutations.
 */
describe("body-part-mapper property: cid casing + angle-bracket insensitivity", () => {
	it("pairs inline image with mixed-case bracketed contentId", async () => {
		const baseSeed = parseSeed() ^ 0xc3c3c3c3;

		for (let i = 0; i < TARGETED_ITERATIONS; i++) {
			const seed = (baseSeed ^ i) | 0;
			const rng = createRng(seed);

			const localPart = `hero-${randomTag(rng)}`;
			const domain = "example.org";
			const baseCid = `${localPart}@${domain}`;

			// Random-case for the BodyPart row's contentId. Sometimes wrapped in
			// `< >`, sometimes not. The leaf's actual Content-ID header (rendered
			// into the EML) is always lower-case with angles — that's what
			// mailparser sees.
			const rowCid = (() => {
				const cased = [...baseCid]
					.map((c) => (rng.bool(0.4) ? c.toUpperCase() : c.toLowerCase()))
					.join("");
				return rng.bool(0.5) ? `<${cased}>` : cased;
			})();

			const imageBytes = Buffer.from(`png-${seed}-${randomTag(rng)}`, "utf8");

			const tree: MultipartNode = {
				kind: "multipart",
				subtype: "related",
				children: [
					{
						kind: "leaf",
						contentType: "text/html",
						bytes: Buffer.from(`<img src="cid:${baseCid}">`, "utf8"),
					},
					{
						kind: "leaf",
						contentType: "image/png",
						bytes: imageBytes,
						contentId: baseCid, // leaf header always normalised; mailparser sees this
						disposition: "inline",
					},
				],
			};

			const eml = renderEml(tree, { seed });
			// Swap the row's contentId for the random-cased / bracketed variant —
			// simulating what BODYSTRUCTURE might persist after a sloppy sender.
			// MapperInput rows are typed as readonly via `Pick<BodyPartItem,...>`
			// so we rebuild the row rather than mutating in place.
			const bodyParts = treeToBodyParts(tree).map((row) =>
				row.mediaType === "IMAGE" ? { ...row, contentId: rowCid } : row,
			);
			const imageRow = bodyParts.find((p) => p.mediaType === "IMAGE");
			assert.ok(imageRow, `seed=${seed}: missing image row in body parts`);

			const parsed = await simpleParser(eml);
			const pairs = mapBodyPartsToContent(bodyParts, parsed);

			assert.equal(pairs.length, 2, `seed=${seed}: expected 2 pairs`);

			const imagePair = pairs.find((p) => p.partPath === "2");
			assert.ok(imagePair, `seed=${seed}: missing image pair`);
			assert.equal(
				imagePair.content.toString("utf8"),
				imageBytes.toString("utf8"),
				`seed=${seed}: image pair did not receive image bytes (rowCid=${rowCid})`,
			);
		}
	});
});

/* -------------------------------------------------------------------- */
/* Helpers                                                              */
/* -------------------------------------------------------------------- */

const randomTag = (rng: { int: (n: number) => number }): string => {
	const letters = "abcdefghijklmnopqrstuvwxyz";
	let s = "";
	for (let i = 0; i < 6; i++) s += letters[rng.int(letters.length)];
	return s;
};
