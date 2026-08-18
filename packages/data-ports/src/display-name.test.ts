import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { storedDisplayName } from "./display-name.js";

const OWN = "matthijs@ischen.nl";
const SPOOFED = "aramirez@secresaludguaviare.gov.co";

/**
 * The name is a stranger's address and nothing else, so nothing survives it.
 */
const emptied: ReadonlyArray<readonly [string, string]> = [
	["the incident", "matthijs@ischen.nl"],
	["quoted", '"matthijs@ischen.nl"'],
	["angle-bracketed", "<matthijs@ischen.nl>"],
	["BATV-wrapped", "prvs=0068b51f37=matthijs@ischen.nl"],
	["upper case", "MATTHIJS@ISCHEN.NL"],
	["a subdomain apart", "matthijs@mail.ischen.nl"],
	["separated by a tab", "\tmatthijs@ischen.nl"],
	["separated by a no-break space", " matthijs@ischen.nl"],
	["separated by a zero-width space", "​matthijs@ischen.nl"],
	["a non-ASCII local part", "Özcan@example.com"],
];

/**
 * The name says something besides the address, and that something is what its
 * recipient knows the sender by. Removing it to remove the address destroys
 * real text on a live instance.
 */
const stripped: ReadonlyArray<readonly [string, string, string]> = [
	["parenthesised", "Support (support@acme.com)", "Support"],
	["angle-bracketed", "Matthijs <matthijs@ischen.nl>", "Matthijs"],
	["comma-separated", "matthijs@ischen.nl, team", "team"],
	["semicolon-separated", "Team; matthijs@ischen.nl", "Team"],
	["colon-separated", "Reply to: matthijs@ischen.nl", "Reply to"],
	["leading and parenthesised", "(matthijs@ischen.nl) Support", "Support"],
	["mid-name", "Support <matthijs@ischen.nl> Team", "Support Team"],
	["with a trailing verb", "matthijs@ischen.nl wrote", "wrote"],
	[
		"quoted around a name",
		'Bob "The Builder" <bob@acme.com>',
		'Bob "The Builder"',
	],
	["a tab away from the name", "Support\tmatthijs@ischen.nl", "Support"],
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
	for (const [what, name] of emptied) {
		it(`empties ${what}`, () => {
			assert.equal(storedDisplayName(name, SPOOFED), "");
		});
	}

	for (const [what, name, remainder] of stripped) {
		it(`keeps what is left after ${what}`, () => {
			assert.equal(storedDisplayName(name, SPOOFED), remainder);
		});
	}

	for (const [what, name] of kept) {
		it(`leaves ${what} alone`, () => {
			assert.equal(storedDisplayName(name, OWN), name);
		});
	}

	it("keeps the address it labels", () => {
		assert.equal(storedDisplayName(OWN, OWN), OWN);
	});

	it("keeps its own address inside a longer name", () => {
		const name = "Matthijs <matthijs@ischen.nl>";
		assert.equal(storedDisplayName(name, OWN), name);
	});

	/**
	 * SQLite folds `A-Z` and stops; JS folds the whole of Unicode. A rule spelled
	 * once in SQL and once in TypeScript disagrees exactly here, and the
	 * disagreement rewrites a name on a live database.
	 */
	it("folds case beyond ASCII on both sides", () => {
		assert.equal(
			storedDisplayName("Özcan@example.com", "özcan@example.com"),
			"Özcan@example.com",
		);
		assert.equal(
			storedDisplayName("ÖZCAN@EXAMPLE.COM", "özcan@example.com"),
			"ÖZCAN@EXAMPLE.COM",
		);
	});

	it("removes any address when the envelope carried none", () => {
		assert.equal(storedDisplayName(`Support ${OWN}`, undefined), "Support");
		assert.equal(storedDisplayName("Matthijs", undefined), "Matthijs");
	});

	it("removes a second address and keeps its own", () => {
		assert.equal(
			storedDisplayName(`${OWN} on behalf of ${SPOOFED}`, OWN),
			`${OWN} on behalf of`,
		);
	});
});
