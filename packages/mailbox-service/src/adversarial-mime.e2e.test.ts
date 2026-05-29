/**
 * E2E adversarial MIME corpus (#402).
 *
 * Each .eml fixture under `test/fixtures/mime-adversarial-e2e/` is APPENDed to
 * the mailfuzz Dovecot INBOX, fetched back via IMAP, then parsed end-to-end
 * with mailparser. The suite asserts the two behaviours called out in #402:
 *
 *   1. body renders            — `parsed.text` or `parsed.html` is non-empty
 *   2. attachments are listable — when the fixture declares attachments, every
 *                                 expected filename appears in `parsed.attachments`
 *                                 with non-zero content length
 *
 * The shapes here are content-driven adversarial cases that real-world senders
 * actually emit (PDF as application/octet-stream, TNEF, nested multipart/related,
 * forwarded message/rfc822, calendar invites, quoted-printable soft breaks,
 * 8-bit UTF-8 bodies, empty text/plain alternatives) — the same class of shape
 * that caused the body-sync regression in #394.
 *
 * Mapper unit-level defence lives in `test/fixtures/mime/`; this suite is the
 * integration-layer belt-and-braces against the same regression class.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type ParsedMail, simpleParser } from "mailparser";
import { withMailfuzzConnection } from "./test-helpers/mailfuzz-connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(
	__dirname,
	"../test/fixtures/mime-adversarial-e2e",
);

interface AttachmentExpectation {
	filename: string;
	contentType?: string;
}

interface FixtureExpectation {
	/** Subject must round-trip — proves the message we fetched is the one we appended. */
	subjectIncludes: string;
	/** At least one of `text` or `html` must be non-empty after parsing. */
	bodyRenders: true;
	/** Attachments expected after parsing. Empty array means "no attachments". */
	attachments: AttachmentExpectation[];
	/** Optional substring that must appear in parsed.text or parsed.html. */
	bodyContains?: string;
}

/**
 * Expectations indexed by .eml basename. Each fixture must have one entry.
 *
 * Filename is the contract — match it exactly to the file on disk.
 */
const EXPECTATIONS: Record<string, FixtureExpectation> = {
	"01-octet-stream-pdf.eml": {
		subjectIncludes: "Adversarial fixture 01",
		bodyRenders: true,
		attachments: [{ filename: "contract.pdf" }],
		bodyContains: "contract PDF",
	},
	"02-nested-related-cid-image.eml": {
		subjectIncludes: "Adversarial fixture 02",
		bodyRenders: true,
		attachments: [
			{ filename: "logo.png", contentType: "image/png" },
			{ filename: "invoice.pdf" },
		],
		bodyContains: "Inline logo",
	},
	"03-calendar-invite.eml": {
		subjectIncludes: "Adversarial fixture 03",
		bodyRenders: true,
		attachments: [{ filename: "invite.ics" }],
		bodyContains: "Meeting invite",
	},
	"04-forwarded-rfc822-with-attachments.eml": {
		subjectIncludes: "Adversarial fixture 04",
		bodyRenders: true,
		// mailparser surfaces the forwarded rfc822 as an attachment whose name
		// derives from the Content-Disposition filename. The inner pdf is not
		// surfaced as a top-level attachment because it lives inside the nested
		// rfc822 — listing the rfc822 itself is the integration-layer contract.
		attachments: [{ filename: "forwarded.eml" }],
		bodyContains: "Forwarding",
	},
	"05-tnef-winmail.eml": {
		subjectIncludes: "Adversarial fixture 05",
		bodyRenders: true,
		attachments: [{ filename: "winmail.dat" }],
		bodyContains: "TNEF",
		// TODO(#402): replace the synthetic TNEF payload with a real-world
		// winmail.dat capture. The minimal magic-byte stub here is enough
		// for mailparser to surface the attachment (which is the #402
		// contract); a real capture would let downstream TNEF decoders
		// extract the inner attachments too.
	},
	"06-8bit-non-ascii.eml": {
		subjectIncludes: "Café façade",
		bodyRenders: true,
		attachments: [],
		bodyContains: "café",
	},
	"07-quoted-printable-soft-breaks.eml": {
		subjectIncludes: "Adversarial fixture 07",
		bodyRenders: true,
		attachments: [],
		// "single" is split across a soft line break in the encoded source;
		// only an actually-decoded quoted-printable reassembles it.
		bodyContains: "single logical line",
	},
	"08-alternative-empty-text.eml": {
		subjectIncludes: "Adversarial fixture 08",
		bodyRenders: true,
		attachments: [],
		// text/plain is empty; rendering must fall back to html.
		bodyContains: "intentionally empty",
	},
};

const listEmlFixtures = (): string[] =>
	readdirSync(FIXTURES_DIR)
		.filter((name) => name.endsWith(".eml"))
		.sort();

const loadFixtureRaw = (name: string): string => {
	const path = join(FIXTURES_DIR, name);
	// Read as utf8 — fixture 06 includes raw 8-bit UTF-8 bytes which IMAP
	// servers accept on APPEND as long as they're valid UTF-8 octets.
	return readFileSync(path, "utf8");
};

const bodyText = (parsed: ParsedMail): string => {
	const text = parsed.text ?? "";
	const html = typeof parsed.html === "string" ? parsed.html : "";
	return `${text}\n${html}`;
};

describe(
	"Adversarial MIME corpus (Dovecot) — #402",
	{ skip: !process.env.RUN_E2E_TESTS },
	() => {
		// Sanity: every .eml on disk has an expectation entry, and every
		// expectation entry points at an existing file. Catches a fixture being
		// added without an assertion (or vice versa).
		test("every fixture has an expectation entry", () => {
			const onDisk = new Set(listEmlFixtures());
			const expected = new Set(Object.keys(EXPECTATIONS));
			for (const name of onDisk) {
				assert.ok(
					expected.has(name),
					`Fixture ${name} has no expectation entry in EXPECTATIONS`,
				);
			}
			for (const name of expected) {
				assert.ok(
					onDisk.has(name),
					`Expectation ${name} has no .eml file on disk`,
				);
			}
			// Pin the count: #402 calls for 8 adversarial shapes.
			assert.equal(
				onDisk.size,
				8,
				"Expected exactly 8 adversarial MIME fixtures",
			);
		});

		for (const name of Object.keys(EXPECTATIONS).sort()) {
			const expectation = EXPECTATIONS[name];
			if (!expectation) continue;

			test(`fixture ${name} round-trips through IMAP and parses`, async () => {
				const raw = loadFixtureRaw(name);

				await withMailfuzzConnection(async (connection) => {
					// APPEND the fixture into INBOX. Mailfuzz uses Dovecot which
					// returns a proper UID on APPEND (mokapi does not — see
					// outbox-roundtrip.e2e.test.ts and the RFC 025 notes).
					const appendResult = await connection.append("INBOX", raw);
					assert.ok(
						appendResult.uid > 0,
						`APPEND should return a UID for ${name}`,
					);

					await connection.openBox("INBOX", true);

					// Fetch the message we just appended back. fetchMessageBody
					// returns the raw RFC822 source; mailparser handles the rest
					// (multipart walking, base64/qp decoding, charset folding).
					const rfc822 = await connection.fetchMessageBody(appendResult.uid);
					assert.ok(
						rfc822.length > 0,
						`fetchMessageBody should return bytes for ${name}`,
					);

					const parsed = await simpleParser(rfc822);

					// Subject round-trips (proves we fetched the right message and
					// any encoded-word headers decoded correctly).
					assert.ok(
						parsed.subject,
						`Parsed subject should be present for ${name}`,
					);
					assert.ok(
						parsed.subject?.includes(expectation.subjectIncludes),
						`Subject "${parsed.subject}" should include "${expectation.subjectIncludes}" for ${name}`,
					);

					// Body renders — at least one of text/html is non-empty. This
					// is the headline "body renders" assertion from #402.
					const text = parsed.text ?? "";
					const html = typeof parsed.html === "string" ? parsed.html : "";
					assert.ok(
						text.trim().length > 0 || html.trim().length > 0,
						`Body should render (text or html non-empty) for ${name}`,
					);

					if (expectation.bodyContains) {
						const haystack = bodyText(parsed).toLowerCase();
						const needle = expectation.bodyContains.toLowerCase();
						assert.ok(
							haystack.includes(needle),
							`Body should contain "${expectation.bodyContains}" for ${name}`,
						);
					}

					// Attachments are listable — every expected attachment appears
					// in parsed.attachments with a matching filename and non-zero
					// content length. This is the "attachments listable" half of
					// the #402 contract.
					const attachments = parsed.attachments ?? [];
					for (const expectedAtt of expectation.attachments) {
						const found = attachments.find(
							(a) => a.filename === expectedAtt.filename,
						);
						assert.ok(
							found,
							`Attachment "${expectedAtt.filename}" should be listable for ${name}; got [${attachments.map((a) => a.filename).join(", ")}]`,
						);
						assert.ok(
							(found.size ?? 0) > 0,
							`Attachment "${expectedAtt.filename}" should have non-zero size for ${name}`,
						);
						if (expectedAtt.contentType) {
							assert.equal(
								found.contentType,
								expectedAtt.contentType,
								`Attachment "${expectedAtt.filename}" should have contentType "${expectedAtt.contentType}" for ${name}`,
							);
						}
					}

					// Note: a follow-up `connection.fetchMessages([uid])` to assert
					// BODYSTRUCTURE round-trips would be redundant — the
					// raw-body fetch above already exercises the IMAP transport,
					// and back-to-back FETCH on the same UID was observed to
					// flake (imapflow occasionally yields a row with undefined
					// uid/internalDate). The mailparser assertions above are
					// what #402 actually asks for ("body renders", "attachments
					// listable"). Existing BODYSTRUCTURE coverage lives in
					// `imapflow-connection.e2e.test.ts`.
				});
			});
		}
	},
);
