import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	collapsibleDomain,
	deriveSenderClauses,
	distinctSenders,
	dominantSender,
	senderDomain,
	senderLabel,
} from "./sender-derivation.js";

describe("senderDomain", () => {
	it("keeps the label sitting under a multi-part public suffix", () => {
		assert.equal(senderDomain("a@bbc.co.uk"), "bbc.co.uk");
		assert.equal(senderDomain("a@shop.example.com.au"), "example.com.au");
	});

	it("strips subdomains down to the registrable domain", () => {
		assert.equal(senderDomain("news@mail.bbc.co.uk"), "bbc.co.uk");
	});

	it("reads the suffix list rather than the trailing labels, so a crafted host cannot pose as one", () => {
		assert.equal(senderDomain("hr@example.co.uk.evil.example"), "evil.example");
	});

	it("has no domain for a bare public suffix, or for a host carrying none", () => {
		assert.equal(senderDomain("a@co.uk"), null);
		assert.equal(senderDomain("postmaster"), null);
	});

	it("agrees with the clause the wizard derives, so a suggested domain is one the matcher produces", () => {
		assert.deepEqual(
			deriveSenderClauses(["news@mail.bbc.co.uk", "sport@bbc.co.uk"]),
			[{ field: "FromDomain", value: senderDomain("news@mail.bbc.co.uk") }],
		);
	});
});

describe("distinctSenders", () => {
	it("drops empties and blanks, trimming what remains", () => {
		assert.deepEqual(
			distinctSenders(["  npm@github.com ", "", "   ", "a@x.com"]),
			["npm@github.com", "a@x.com"],
		);
	});

	it("de-duplicates case-insensitively, keeping first-seen casing and order", () => {
		assert.deepEqual(
			distinctSenders([
				"NPM@github.com",
				"a@x.com",
				"npm@GITHUB.com",
				"a@x.com",
			]),
			["NPM@github.com", "a@x.com"],
		);
	});
});

describe("collapsibleDomain", () => {
	it("returns the shared registrable domain when every sender matches it", () => {
		assert.equal(
			collapsibleDomain([
				"npm@github.com",
				"notifications@github.com",
				"ci@sub.github.com",
			]),
			"github.com",
		);
	});

	it("does not collapse a single sender to its whole domain", () => {
		assert.equal(collapsibleDomain(["npm@github.com"]), null);
	});

	it("does not collapse when a sender's domain differs", () => {
		assert.equal(collapsibleDomain(["npm@github.com", "a@x.com"]), null);
	});

	it("does not collapse when any sender's domain cannot be resolved", () => {
		assert.equal(
			collapsibleDomain(["npm@github.com", "malformed-no-at-sign"]),
			null,
		);
	});
});

describe("deriveSenderClauses", () => {
	it("emits one From clause per distinct sender when domains differ", () => {
		assert.deepEqual(
			deriveSenderClauses(["npm@github.com", "npm@github.com", "a@x.com"]),
			[
				{ field: "From", value: "npm@github.com" },
				{ field: "From", value: "a@x.com" },
			],
		);
	});

	it("collapses to a single FromDomain clause when every sender shares a domain", () => {
		assert.deepEqual(
			deriveSenderClauses([
				"npm@github.com",
				"notifications@github.com",
				"ci@sub.github.com",
			]),
			[{ field: "FromDomain", value: "github.com" }],
		);
	});

	it("keeps per-address From clauses for the mixed case", () => {
		assert.deepEqual(
			deriveSenderClauses([
				"npm@github.com",
				"ci@github.com",
				"newsletter@example.org",
			]),
			[
				{ field: "From", value: "npm@github.com" },
				{ field: "From", value: "ci@github.com" },
				{ field: "From", value: "newsletter@example.org" },
			],
		);
	});

	it("is empty when no sender survives", () => {
		assert.deepEqual(deriveSenderClauses(["", "  "]), []);
	});

	it("collapses a multi-label public suffix to the registrable domain", () => {
		// The public-suffix list is what makes this foo.co.uk; the trailing two
		// labels of the host are co.uk, which matches every British domain.
		assert.deepEqual(deriveSenderClauses(["a@foo.co.uk", "b@foo.co.uk"]), [
			{ field: "FromDomain", value: "foo.co.uk" },
		]);
	});
});

describe("dominantSender", () => {
	const envelope = (normalizedEmail: string, displayName?: string) => ({
		normalizedEmail,
		displayName,
	});

	it("takes the sender carrying most of the selection", () => {
		assert.deepEqual(
			dominantSender([
				envelope("noreply@booking.com", "Booking.com"),
				envelope("automated@airbnb.com", "Airbnb"),
				envelope("noreply@booking.com", "Booking.com"),
			]),
			envelope("noreply@booking.com", "Booking.com"),
		);
	});

	it("counts one address writing under two names as one sender", () => {
		assert.deepEqual(
			dominantSender([
				envelope("info@klm.com", "KLM"),
				envelope("INFO@klm.com", "KLM Royal Dutch Airlines"),
				envelope("noreply@sixt.com", "Sixt"),
			]),
			envelope("info@klm.com", "KLM"),
		);
	});

	it("has no answer for an empty selection", () => {
		assert.equal(dominantSender([]), undefined);
		assert.equal(dominantSender([envelope("  ")]), undefined);
	});
});

describe("senderLabel", () => {
	it("reads the display name, and the address when there is none", () => {
		assert.equal(
			senderLabel({ normalizedEmail: "a@b.example", displayName: "Ada" }),
			"Ada",
		);
		assert.equal(
			senderLabel({ normalizedEmail: "a@b.example", displayName: "  " }),
			"a@b.example",
		);
		assert.equal(
			senderLabel({ normalizedEmail: "a@b.example" }),
			"a@b.example",
		);
	});
});
