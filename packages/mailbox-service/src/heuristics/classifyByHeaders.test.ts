import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageCategory } from "@remit/domain-enums";
import { simpleParser } from "mailparser";
import { classifyByHeaders, extractAuthenticity } from "./classifyByHeaders.js";

const buildEml = (lines: string[]): Buffer => Buffer.from(lines.join("\r\n"));

const parse = async (lines: string[]) => simpleParser(buildEml(lines));

describe("classifyByHeaders", () => {
	it("returns automated for Auto-Submitted: auto-generated", async () => {
		const parsed = await parse([
			"From: noreply@example.com",
			"To: bob@example.com",
			"Subject: Out of office",
			"Auto-Submitted: auto-generated",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
	});

	it("returns automated for Auto-Submitted: auto-replied", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: Re: vacation",
			"Auto-Submitted: auto-replied",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
	});

	it("ignores Auto-Submitted: no", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: hello",
			"Auto-Submitted: no",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.personal);
	});

	it("returns automated for Precedence: bulk", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: announcement",
			"Precedence: bulk",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
	});

	it("returns automated for Precedence: list", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: list",
			"Precedence: list",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
	});

	it("returns automated for Precedence: junk", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: junk",
			"Precedence: junk",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
	});

	it("returns transactional for a calendar invite (text/calendar part)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: Meeting invite",
			'Content-Type: multipart/mixed; boundary="bnd"',
			"",
			"--bnd",
			"Content-Type: text/plain",
			"",
			"see attached invite",
			"--bnd",
			'Content-Type: text/calendar; method=REQUEST; name="invite.ics"',
			'Content-Disposition: attachment; filename="invite.ics"',
			"",
			"BEGIN:VCALENDAR",
			"END:VCALENDAR",
			"--bnd--",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.transactional);
	});

	it("returns transactional for a sender on the transactional allow-list (github.com)", async () => {
		const parsed = await parse([
			"From: noreply@github.com",
			"To: bob@example.com",
			"Subject: Security alert",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.transactional);
	});

	it("returns transactional for a subdomain of an allow-listed transactional domain", async () => {
		const parsed = await parse([
			"From: receipts@billing.stripe.com",
			"To: bob@example.com",
			"Subject: Receipt",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.transactional);
	});

	it("returns newsletter when both List-Unsubscribe and List-Id are present", async () => {
		const parsed = await parse([
			"From: news@news.example.com",
			"To: bob@example.com",
			"Subject: Weekly digest",
			"List-Id: <weekly.news.example.com>",
			"List-Unsubscribe: <https://news.example.com/u>",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.newsletter);
	});

	it("returns marketing when only List-Unsubscribe is present (no List-Id)", async () => {
		const parsed = await parse([
			"From: deals@shop.example.com",
			"To: bob@example.com",
			"Subject: 50% off",
			"List-Unsubscribe: <https://shop.example.com/u>",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.marketing);
	});

	it("returns automated when DKIM d= mismatches the From domain", async () => {
		const parsed = await parse([
			"From: alice@personal.example.com",
			"To: bob@example.com",
			"Subject: forwarded",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
	});

	it("does NOT flag DKIM d= as mismatched when domains share a common root", async () => {
		const parsed = await parse([
			"From: alice@mail.example.com",
			"To: bob@example.com",
			"Subject: ok",
			"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=sel; b=xxx",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.personal);
	});

	it("returns social for a sender on the social allow-list (linkedin.com)", async () => {
		const parsed = await parse([
			"From: notifications@linkedin.com",
			"To: bob@example.com",
			"Subject: someone viewed your profile",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.social);
	});

	it("returns social for a subdomain of an allow-listed social domain", async () => {
		const parsed = await parse([
			"From: noreply@email.x.com",
			"To: bob@example.com",
			"Subject: New follower",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.social);
	});

	it("returns personal for plain mail with no special headers", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: lunch?",
			"",
			"hi bob, lunch on friday?",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.personal);
	});

	it("returns personal when From has no parseable address", async () => {
		const parsed = await parse([
			"From: ",
			"To: bob@example.com",
			"Subject: weird",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.personal);
	});

	it("category stays automated for DKIM mismatch even when extractAuthenticity also reports mismatch", async () => {
		const parsed = await parse([
			"From: alice@personal.example.com",
			"To: bob@example.com",
			"Subject: forwarded",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
			"",
			"body",
		]);
		// Both must agree — category heuristic and structured field
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "authenticity should be present");
		assert.equal(auth.dkimMismatch, true);
	});

	it("transactional rule wins over List-Unsubscribe", async () => {
		// GitHub mail typically has List-Unsubscribe + List-Id (newsletter
		// signal), but the EDD says transactional allow-list wins because
		// receipts/security alerts are higher priority than newsletter framing.
		const parsed = await parse([
			"From: noreply@github.com",
			"To: bob@example.com",
			"Subject: Security alert",
			"List-Id: <alerts.github.com>",
			"List-Unsubscribe: <https://github.com/u>",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.transactional);
	});

	it("Auto-Submitted wins over List-Unsubscribe", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: list bounce",
			"Auto-Submitted: auto-generated",
			"List-Unsubscribe: <https://example.com/u>",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
	});
});

describe("extractAuthenticity", () => {
	it("returns null when no DKIM-Signature header is present", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: no dkim",
			"",
			"body",
		]);
		assert.equal(extractAuthenticity(parsed), null);
	});

	it("returns null when From address is missing", async () => {
		const parsed = await parse([
			"From: ",
			"To: bob@example.com",
			"Subject: weird",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
			"",
			"body",
		]);
		assert.equal(extractAuthenticity(parsed), null);
	});

	it("returns dkimMismatch: true when signing domain differs from From domain", async () => {
		const parsed = await parse([
			"From: alice@personal.example.com",
			"To: bob@example.com",
			"Subject: forwarded",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.fromDomain, "personal.example.com");
		assert.equal(auth.dkimDomain, "relay.example.net");
		assert.equal(auth.dkimMismatch, true);
	});

	it("returns dkimMismatch: false when signing domain equals From domain (aligned)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: aligned",
			"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=sel; b=xxx",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.fromDomain, "example.com");
		assert.equal(auth.dkimDomain, "example.com");
		assert.equal(auth.dkimMismatch, false);
	});

	it("returns dkimMismatch: false for subdomain-aligned signing (d= is parent of From domain)", async () => {
		const parsed = await parse([
			"From: alice@mail.example.com",
			"To: bob@example.com",
			"Subject: subdomain ok",
			"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=sel; b=xxx",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.fromDomain, "mail.example.com");
		assert.equal(auth.dkimMismatch, false);
	});

	it("returns dkimMismatch: false for subdomain-aligned signing (d= is child of From domain)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: child ok",
			"DKIM-Signature: v=1; a=rsa-sha256; d=mail.example.com; s=sel; b=xxx",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.fromDomain, "example.com");
		assert.equal(auth.dkimMismatch, false);
	});

	it("handles multiple DKIM signatures: aligned signature wins (no mismatch)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: multi",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=s1; b=xxx",
			"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=s2; b=yyy",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, false);
	});

	it("reports first mismatching domain when all signatures mismatch", async () => {
		const parsed = await parse([
			"From: alice@personal.example.com",
			"To: bob@example.com",
			"Subject: all mismatch",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay-a.net; s=s1; b=xxx",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay-b.net; s=s2; b=yyy",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, true);
		assert.equal(auth.dkimDomain, "relay-a.net");
	});

	it("category and dkimMismatch always agree (mismatch case)", async () => {
		const parsed = await parse([
			"From: alice@personal.example.com",
			"To: bob@example.com",
			"Subject: forwarded",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
			"",
			"body",
		]);
		const category = classifyByHeaders(parsed);
		const auth = extractAuthenticity(parsed);
		assert.equal(category, MessageCategory.automated);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, true);
	});

	it("category and dkimMismatch always agree (aligned case)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: aligned",
			"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=sel; b=xxx",
			"",
			"body",
		]);
		const category = classifyByHeaders(parsed);
		const auth = extractAuthenticity(parsed);
		assert.equal(category, MessageCategory.personal);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, false);
	});
});
