import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DisplayNameCorrespondence } from "@remit/domain-enums";
import { simpleParser } from "mailparser";
import * as tldts from "tldts";
import { classifyDisplayNameCorrespondence } from "../spam/display-name.js";
import {
	extractOffDomainLinkDomains,
	extractSenderMismatch,
} from "./senderMismatch.js";

const parse = async (lines: string[]) =>
	simpleParser(Buffer.from(lines.join("\r\n")));

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

describe("extractOffDomainLinkDomains", () => {
	it("names only the registrable domains that leave the sender's own", async () => {
		const parsed = await parse([
			"From: Jira <jira@serviceupdatebank.atlassian.net>",
			"To: bob@example.com",
			"Subject: Vordering",
			"Content-Type: text/html",
			"",
			'<a href="https://serviceupdatebank.atlassian.net/browse/X">ticket</a>',
			'<a href="https://betaal-vordering.example.org/pay">betaal nu</a>',
			'<a href="https://cdn.betaal-vordering.example.org/logo.png">logo</a>',
		]);
		assert.deepEqual(
			extractOffDomainLinkDomains(
				parsed,
				"serviceupdatebank.atlassian.net",
				tldts,
			),
			["example.org"],
		);
	});

	it("compares public-suffix-aware, so a co.uk sibling is not off-domain", async () => {
		const parsed = await parse([
			"From: Shop <shop@mail.example.co.uk>",
			"To: bob@example.com",
			"Subject: order",
			"Content-Type: text/html",
			"",
			'<a href="https://www.example.co.uk/orders">orders</a>',
		]);
		assert.deepEqual(
			extractOffDomainLinkDomains(parsed, "mail.example.co.uk", tldts),
			[],
		);
	});

	it("ignores mailto, anchors and relative hrefs", async () => {
		const parsed = await parse([
			"From: Shop <shop@example.com>",
			"To: bob@example.com",
			"Subject: order",
			"Content-Type: text/html",
			"",
			'<a href="mailto:help@elsewhere.example">mail us</a>',
			'<a href="#top">top</a>',
			'<a href="/orders">orders</a>',
			'<a href="tel:+31201234567">call</a>',
		]);
		assert.deepEqual(
			extractOffDomainLinkDomains(parsed, "example.com", tldts),
			[],
		);
	});

	it("reads bare URLs out of a plain-text body", async () => {
		const parsed = await parse([
			"From: Shop <shop@example.com>",
			"To: bob@example.com",
			"Subject: order",
			"",
			"Betaal hier: https://betaal.elsewhere.example/pay?id=1",
		]);
		assert.deepEqual(
			extractOffDomainLinkDomains(parsed, "example.com", tldts),
			["elsewhere.example"],
		);
	});
});

describe("extractSenderMismatch", () => {
	const infoMedicsPhish = [
		"From: InfoMedics <jira@serviceupdatebank.atlassian.net>",
		"To: bob@example.com",
		"Subject: Vordering",
		"Authentication-Results: mx.example.com; dmarc=pass; spf=pass; dkim=pass",
		"X-HalOne-Spam-Probability: 1",
		"DKIM-Signature: v=1; a=rsa-sha256; d=custmx.one.com; s=sel; b=xxx",
		"Content-Type: text/html",
		"",
		'<a href="https://betaal-vordering.example.org/pay">Betaal uw factuur</a>',
	];

	it("flags an unrelated display name and an off-domain link", async () => {
		const parsed = await parse(infoMedicsPhish);
		assert.deepEqual(
			await extractSenderMismatch(parsed, {
				fromDomain: "serviceupdatebank.atlassian.net",
				bulkSender: false,
			}),
			{
				displayNameCorrespondence: DisplayNameCorrespondence.Unrelated,
				offDomainLinkDomains: ["example.org"],
			},
		);
	});

	it("flags a display name spelling the recipient's own address over a foreign domain", async () => {
		const parsed = await parse([
			"From: matthijs@ischen.nl <aramirez@secresaludguaviare.gov.co>",
			"To: matthijs@ischen.nl",
			"Subject: Re: factura",
			"X-HalOne-Spam-Probability: 1",
			"",
			"hola",
		]);
		assert.equal(
			(
				await extractSenderMismatch(parsed, {
					fromDomain: "secresaludguaviare.gov.co",
					bulkSender: false,
				})
			).displayNameCorrespondence,
			DisplayNameCorrespondence.ForeignAddress,
		);
	});

	it("leaves the display name uncompared for a bulk sender", async () => {
		const parsed = await parse([
			"From: Dutch Cycling Weekly <bounce-9f2@mailer.esp.example>",
			"To: bob@example.com",
			"Subject: This week in cycling",
			"List-Unsubscribe: <https://mailer.esp.example/u/9f2>",
			"X-HalOne-Spam-Probability: 1",
			"Content-Type: text/html",
			"",
			'<a href="https://dutchcyclingweekly.example.org/issue/12">read</a>',
		]);
		const signals = await extractSenderMismatch(parsed, {
			fromDomain: "mailer.esp.example",
			bulkSender: true,
		});
		assert.equal(signals.displayNameCorrespondence, undefined);
		assert.deepEqual(signals.offDomainLinkDomains, ["example.org"]);
	});
});
