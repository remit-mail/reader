import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DisplayNameCorrespondence } from "@remit/domain-enums";
import * as tldts from "tldts";
import { classifyDisplayNameCorrespondence } from "./display-name.js";

describe("classifyDisplayNameCorrespondence", () => {
	it("corresponds when the name is a label of the From domain", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"GitHub",
				"notifications.github.com",
				tldts,
			),
			DisplayNameCorrespondence.Corresponds,
		);
	});

	it("corresponds when a word of a decorated name is a label of the From domain", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"GitHub Actions",
				"notifications.github.com",
				tldts,
			),
			DisplayNameCorrespondence.Corresponds,
		);
	});

	it("corresponds across a multi-part public suffix", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"Sainsbury's",
				"mail.sainsburys.co.uk",
				tldts,
			),
			DisplayNameCorrespondence.Corresponds,
		);
	});

	it("is unrelated when the name appears nowhere in the From domain", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"InfoMedics",
				"serviceupdatebank.atlassian.net",
				tldts,
			),
			DisplayNameCorrespondence.Unrelated,
		);
	});

	it("is a lookalike when a digit stands in for a letter of the domain", () => {
		assert.equal(
			classifyDisplayNameCorrespondence("InfoMedics", "1nfomedics.nl", tldts),
			DisplayNameCorrespondence.Lookalike,
		);
	});

	it("is a lookalike for a short brand one character off", () => {
		assert.equal(
			classifyDisplayNameCorrespondence("PayPal", "paypa1.com", tldts),
			DisplayNameCorrespondence.Lookalike,
		);
	});

	it("claims nothing when the display name is empty", () => {
		assert.equal(
			classifyDisplayNameCorrespondence("", "example.com", tldts),
			DisplayNameCorrespondence.NoClaim,
		);
		assert.equal(
			classifyDisplayNameCorrespondence(undefined, "example.com", tldts),
			DisplayNameCorrespondence.NoClaim,
		);
	});

	it("claims nothing when the display name is an address at the sending domain", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"billing@serviceupdatebank.atlassian.net",
				"serviceupdatebank.atlassian.net",
				tldts,
			),
			DisplayNameCorrespondence.NoClaim,
		);
	});

	it("claims nothing when the display name spells the envelope address itself", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"matthijs@ischen.nl",
				"ischen.nl",
				tldts,
			),
			DisplayNameCorrespondence.NoClaim,
		);
	});

	it("claims nothing when the display name is an address on a sibling subdomain", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"noreply@example.co.uk",
				"mail.example.co.uk",
				tldts,
			),
			DisplayNameCorrespondence.NoClaim,
		);
	});

	it("is a foreign address when the display name spells an address over another domain", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"matthijs@ischen.nl",
				"secresaludguaviare.gov.co",
				tldts,
			),
			DisplayNameCorrespondence.ForeignAddress,
		);
	});

	it("is a foreign address when the spelled-out address is decorated with a name", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"Matthijs (matthijs@ischen.nl)",
				"secresaludguaviare.gov.co",
				tldts,
			),
			DisplayNameCorrespondence.ForeignAddress,
		);
	});

	it("compares an at sign that spells no address as an ordinary name", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"Support @ InfoMedics",
				"infomedics.nl",
				tldts,
			),
			DisplayNameCorrespondence.Corresponds,
		);
		assert.equal(
			classifyDisplayNameCorrespondence(
				"Support @ InfoMedics",
				"serviceupdatebank.atlassian.net",
				tldts,
			),
			DisplayNameCorrespondence.Unrelated,
		);
	});

	it("does not read the public suffix as a match for a brand containing it", () => {
		assert.equal(
			classifyDisplayNameCorrespondence("Netflix", "mailer.example.net", tldts),
			DisplayNameCorrespondence.Unrelated,
		);
	});

	// Live phishing shape: a short, valuable brand name embedded as a
	// coincidental substring of a longer, attacker-chosen domain. "ing" sits
	// inside "secureingverify" the same way "irs"/"dhl"/"ups"/"kpn" sit inside
	// countless lookalike domains — none of that is the domain naming the
	// brand.
	it("does not match a short brand name that is merely embedded in a longer domain label (ING)", () => {
		assert.equal(
			classifyDisplayNameCorrespondence(
				"ING Fraudedesk",
				"secure-ing-verify.tk",
				tldts,
			),
			DisplayNameCorrespondence.Unrelated,
		);
	});

	it("still matches a short brand name against its own real domain", () => {
		assert.equal(
			classifyDisplayNameCorrespondence("ING", "ing.nl", tldts),
			DisplayNameCorrespondence.Corresponds,
		);
	});
});
