import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isImpersonatingDisplayName } from "./display-name.js";

const OWN = "matthijs@ischen.nl";

const refused: ReadonlyArray<readonly [string, string]> = [
	["the incident", "matthijs@ischen.nl"],
	["angle-bracketed inside a name", "Matthijs <matthijs@ischen.nl>"],
	["parenthesised", "Matthijs (matthijs@ischen.nl)"],
	["quoted", '"matthijs@ischen.nl"'],
	["with a trailing sentence", "matthijs@ischen.nl wrote:"],
	["comma-separated", "matthijs@ischen.nl, team"],
	["separated by a tab", "support\tmatthijs@ischen.nl"],
	["separated by a no-break space", "support matthijs@ischen.nl"],
	["separated by a zero-width space", "support​matthijs@ischen.nl"],
	["BATV-wrapped", "prvs=0068b51f37=matthijs@ischen.nl"],
	["a subdomain apart", "matthijs@mail.ischen.nl"],
	["upper case", "MATTHIJS@ISCHEN.NL"],
	["a non-ASCII local part", "Özcan@example.com"],
];

const kept: ReadonlyArray<readonly [string, string]> = [
	["an ordinary human name", "Matthijs van Henten"],
	["a name with a full stop", "Dr. M. van Henten"],
	["a company name", "ING Bank N.V."],
	["a bare word", "Newsletter"],
	["an empty name", ""],
	["a name with an at-sign but no domain", "me @ home"],
	["a social handle", "@matthijs"],
	["a version string", "release 2.11"],
	["a domain with no local part", "ischen.nl"],
	["a single-letter tld", "a@b.c"],
];

describe("a display name that claims to be an address", () => {
	for (const [what, name] of refused) {
		it(`refuses ${what}`, () => {
			assert.equal(
				isImpersonatingDisplayName(name, "aramirez@secresaludguaviare.gov.co"),
				true,
			);
		});
	}

	for (const [what, name] of kept) {
		it(`keeps ${what}`, () => {
			assert.equal(isImpersonatingDisplayName(name, OWN), false);
		});
	}

	it("keeps the address it labels", () => {
		assert.equal(isImpersonatingDisplayName(OWN, OWN), false);
	});

	it("keeps its own address inside a longer name", () => {
		assert.equal(
			isImpersonatingDisplayName("Matthijs <matthijs@ischen.nl>", OWN),
			false,
		);
	});

	/**
	 * SQLite folds `A-Z` and stops; JS folds the whole of Unicode. A rule spelled
	 * once in SQL and once in TypeScript disagrees exactly here, and the
	 * disagreement destroys a name on a live database.
	 */
	it("folds case beyond ASCII on both sides", () => {
		assert.equal(
			isImpersonatingDisplayName("Özcan@example.com", "özcan@example.com"),
			false,
		);
		assert.equal(
			isImpersonatingDisplayName("ÖZCAN@EXAMPLE.COM", "özcan@example.com"),
			false,
		);
	});

	it("refuses any address when the envelope carried none", () => {
		assert.equal(isImpersonatingDisplayName(OWN, undefined), true);
		assert.equal(isImpersonatingDisplayName("Matthijs", undefined), false);
	});

	it("refuses a name carrying its own address and a second one", () => {
		assert.equal(
			isImpersonatingDisplayName(
				"matthijs@ischen.nl on behalf of aramirez@secresaludguaviare.gov.co",
				OWN,
			),
			true,
		);
	});
});
