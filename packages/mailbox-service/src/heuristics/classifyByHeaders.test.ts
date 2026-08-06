import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageCategory } from "@remit/domain-enums";
import { simpleParser } from "mailparser";
import {
	classifyByHeaders,
	extractAuthenticity,
	extractAuthResult,
	extractHasListUnsubscribe,
	extractProviderSpam,
} from "./classifyByHeaders.js";

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

	it("stays personal when an earlier mismatching DKIM-Signature is followed by an aligned one", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: multi",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=s1; b=xxx",
			"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=s2; b=yyy",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.personal);
	});

	it("returns automated when every DKIM-Signature domain mismatches", async () => {
		const parsed = await parse([
			"From: alice@personal.example.com",
			"To: bob@example.com",
			"Subject: all mismatch",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay-a.net; s=s1; b=xxx",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay-b.net; s=s2; b=yyy",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.automated);
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
			"Authentication-Results: mx.example.com; dkim=pass header.d=relay.example.net",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
			"",
			"body",
		]);
		// The category heuristic reads the raw DKIM-Signature; extractAuthenticity
		// reads the trust boundary's own Authentication-Results verdict. They agree
		// here because both name the same domain, not because they share a source.
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

	it("List-Unsubscribe wins over Auto-Submitted", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: list bounce",
			"Auto-Submitted: auto-generated",
			"List-Unsubscribe: <https://example.com/u>",
			"",
			"body",
		]);
		assert.equal(classifyByHeaders(parsed), MessageCategory.marketing);
	});
});

describe("extractAuthenticity", () => {
	it("returns null when there is no DKIM-Signature and no Authentication-Results at all", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: no signal",
			"",
			"body",
		]);
		assert.equal(extractAuthenticity(parsed), null);
	});

	// #603 CI finding A: an absent or failing DKIM result must still yield a
	// signal from the raw signature — the most common phishing shape (a
	// failed/absent Authentication-Results result) must not silently lose the
	// demote-to-Junk path. dkimDomain stays absent because nothing trustworthy
	// confirmed the alignment — see the next test for the mismatching case,
	// where the raw domain IS reported.
	it("falls back to the raw DKIM-Signature when Authentication-Results carries no dkim=pass result, and does not report an aligned domain from it", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: dkim failed",
			"Authentication-Results: mx.example.com; dkim=fail header.d=example.com",
			"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=sel; b=xxx",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, false);
		assert.equal(auth.dkimDomain, undefined);
	});

	it("falls back to the raw DKIM-Signature to report a mismatch when Authentication-Results has no dkim=pass result", async () => {
		// The DEMOTE_EML shape from body-sync-placement-writeonce.test.ts: dmarc
		// fails, there is no dkim= result in Authentication-Results at all, and
		// the raw signature names a domain unrelated to the sender.
		const parsed = await parse([
			"From: Support <support@evil-mimic.example>",
			"To: me@example.com",
			"Subject: Verify your account",
			"Authentication-Results: mx.example.com; dmarc=fail",
			"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, true);
		assert.equal(auth.dkimDomain, "relay.example.net");
	});

	it("returns null when the dkim=pass result carries no header.d or header.i, and there is no raw signature either", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: no header.d",
			"Authentication-Results: mx.example.com; dkim=pass",
			"",
			"body",
		]);
		assert.equal(extractAuthenticity(parsed), null);
	});

	// A bare dkim=fail — no header.d, no header.i — says a signature failed
	// verification, not that the sender is forged: there is no domain to
	// weigh against the From address at all. Pre-merge review: this used to
	// unconditionally report a mismatch, which auto-junked ordinary mail a
	// gateway had already flagged not-spam.
	it("returns null for an explicit Authentication-Results dkim=fail that names no domain", async () => {
		const parsed = await parse([
			"From: alice@evil.example",
			"To: bob@example.com",
			"Subject: unsigned",
			"Authentication-Results: mx.example.com; spf=fail; dkim=fail; dmarc=fail",
			"",
			"body",
		]);
		assert.equal(extractAuthenticity(parsed), null);
	});

	it("still returns null for a merely absent dkim result (no fail, no pass, no signature)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: no dkim mentioned at all",
			"Authentication-Results: mx.example.com; spf=pass; dmarc=pass",
			"",
			"body",
		]);
		assert.equal(extractAuthenticity(parsed), null);
	});

	// A dkim=fail that DOES name a domain, and that domain itself does not
	// align with the From address — the unsigned-phishing shape this exists
	// to catch: a signature was attempted (and failed) for a domain that
	// does not even match what the sender claims.
	it("reports a mismatch from a dkim=fail naming a domain unrelated to the From address", async () => {
		const parsed = await parse([
			"From: Alice <alice@acme.com>",
			"To: bob@example.com",
			"Subject: hi",
			"Authentication-Results: mx.example.com; dkim=fail header.d=attacker.example; dmarc=fail",
			"X-Spam-Status: No, score=0.1",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, true);
		assert.equal(auth.dkimDomain, "attacker.example");
	});

	// Pre-merge review, adversarial case 1: the regex reading dkim=fail used
	// to be unanchored across the whole header text, so it matched a
	// "dkim=fail" token sitting inside a DIFFERENT mechanism's comment
	// (here, arc=fail's). There is no dkim= result of its own in this
	// header at all.
	it("does not misread a dkim=fail token embedded in an unrelated mechanism's comment", async () => {
		const parsed = await parse([
			"From: Bob <bob@smallshop.nl>",
			"Authentication-Results: mx.example.net; arc=fail (i=1 spf=pass dkim=fail",
			"  dkimdomain=smallshop.nl dmarc=fail); spf=pass smtp.mailfrom=smallshop.nl;",
			"  dmarc=fail header.from=smallshop.nl",
			"X-Spam-Status: No, score=0.1",
			"To: me@example.com",
			"Subject: hi",
			"",
			"body",
		]);
		assert.equal(extractAuthenticity(parsed), null);
	});

	// Pre-merge review, adversarial case 2: a corporate gateway that
	// verifies a signature, finds the body hash broken by an intermediate
	// relay, and reports dkim=fail — but still names the SENDER's own
	// domain in header.d. That is relay noise, not forgery: the domain
	// named checks out.
	it("does not report a mismatch when a dkim=fail names the From address's own domain", async () => {
		const parsed = await parse([
			"From: Alice <alice@acme.com>",
			"To: bob@example.com",
			"Subject: hi",
			"Authentication-Results: gw.corp.example; dkim=fail (body hash did not verify)",
			"  header.d=acme.com; spf=pass; dmarc=fail (p=REJECT) header.from=acme.com",
			"X-Spam-Status: No, score=0.1",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, false);
	});

	// CI review, regression against main: preferring Authentication-Results
	// over the raw signature for the MISMATCH question means a mailing list
	// or corporate gateway that legitimately re-signs and breaks the
	// author's own signature would read as a mismatch — Authentication-Results
	// only lists what actually verified (googlegroups.com), while the raw
	// headers still carry the original, aligned signature (acme.com)
	// alongside it. Either source showing alignment must be enough to clear
	// dkimMismatch, or ordinary list mail auto-junks.
	it("does not report a mismatch when the raw signature aligns even though Authentication-Results prefers an unrelated one (Google Groups shape)", async () => {
		const parsed = await parse([
			"From: Alice <alice@acme.com>",
			"To: list@googlegroups.com",
			"Subject: hi",
			"Authentication-Results: mx.google.com; dkim=pass header.d=googlegroups.com; spf=pass smtp.mailfrom=googlegroups.com; dmarc=fail (p=REJECT) header.from=acme.com",
			"DKIM-Signature: v=1; a=rsa-sha256; d=acme.com; s=sel; b=xxx",
			"DKIM-Signature: v=1; a=rsa-sha256; d=googlegroups.com; s=sel2; b=yyy",
			"X-Spam-Status: No, score=0.2",
			"Content-Type: text/plain",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimMismatch, false);
	});

	// #603 CI finding E: some verifiers emit only header.i, not header.d.
	it("falls back to the domain in header.i when the dkim=pass result carries no header.d", async () => {
		const parsed = await parse([
			"From: alice@ing.nl",
			"To: bob@example.com",
			"Subject: header.i only",
			"Authentication-Results: mx.example.com; dkim=pass header.i=@ing.nl header.s=sel",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimDomain, "ing.nl");
		assert.equal(auth.dkimMismatch, false);
	});

	// #603 CI finding B: a message can carry more than one passing signature —
	// e.g. an ESP infrastructure domain alongside the sender's own. The
	// aligned one must win over an earlier unrelated one; naively taking the
	// first would misreport (and auto-junk) any SES/Mailchimp/Google-Groups
	// sender whose third-party signature happens to be listed first.
	it("prefers an aligned dkim=pass result over an earlier unrelated one", async () => {
		const parsed = await parse([
			"From: alice@acme.com",
			"To: bob@example.com",
			"Subject: ESP infra signature listed first",
			"Authentication-Results: mx.example.com; dkim=pass header.d=amazonses.com; dkim=pass header.d=acme.com",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimDomain, "acme.com");
		assert.equal(auth.dkimMismatch, false);
	});

	it("returns null when From address is missing", async () => {
		const parsed = await parse([
			"From: ",
			"To: bob@example.com",
			"Subject: weird",
			"Authentication-Results: mx.example.com; dkim=pass header.d=relay.example.net",
			"",
			"body",
		]);
		assert.equal(extractAuthenticity(parsed), null);
	});

	// #603: a message relayed through a re-signing host (e.g. a receiving MX
	// that re-signs on the way in) carries that host's own DKIM-Signature, not
	// the sender's. The domain must come from Authentication-Results'
	// header.d, which names the domain the trust boundary actually verified —
	// never from the (possibly re-signed) DKIM-Signature header.
	it("takes the signing domain from Authentication-Results header.d, not the DKIM-Signature header", async () => {
		const parsed = await parse([
			"From: alice@sabrinabasten.com",
			"To: bob@example.com",
			"Subject: relayed",
			"Authentication-Results: mx.custmx.one.com; dkim=pass header.d=server104.greatnet.de header.s=sel",
			"DKIM-Signature: v=1; a=rsa-sha256; d=custmx.one.com; s=sel; b=xxx",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimDomain, "server104.greatnet.de");
		assert.notEqual(auth.dkimDomain, "custmx.one.com");
	});

	it("returns dkimMismatch: true when the authenticated domain differs from From domain", async () => {
		const parsed = await parse([
			"From: alice@personal.example.com",
			"To: bob@example.com",
			"Subject: forwarded",
			"Authentication-Results: mx.example.com; dkim=pass header.d=relay.example.net",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.fromDomain, "personal.example.com");
		assert.equal(auth.dkimDomain, "relay.example.net");
		assert.equal(auth.dkimMismatch, true);
	});

	it("returns dkimMismatch: false when the authenticated domain equals From domain (aligned)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: aligned",
			"Authentication-Results: mx.example.com; dkim=pass header.d=example.com",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.fromDomain, "example.com");
		assert.equal(auth.dkimDomain, "example.com");
		assert.equal(auth.dkimMismatch, false);
	});

	it("returns dkimMismatch: false for subdomain-aligned authenticated domain (parent of From domain)", async () => {
		const parsed = await parse([
			"From: alice@mail.example.com",
			"To: bob@example.com",
			"Subject: subdomain ok",
			"Authentication-Results: mx.example.com; dkim=pass header.d=example.com",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.fromDomain, "mail.example.com");
		assert.equal(auth.dkimMismatch, false);
	});

	it("returns dkimMismatch: false for subdomain-aligned authenticated domain (child of From domain)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: child ok",
			"Authentication-Results: mx.example.com; dkim=pass header.d=mail.example.com",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.fromDomain, "example.com");
		assert.equal(auth.dkimMismatch, false);
	});

	it("reads header.d off the dkim= resinfo when spf/dmarc results are also present", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: multi mechanism",
			"Authentication-Results: mx.example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=alice@example.com; dkim=pass header.d=example.com header.s=sel",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimDomain, "example.com");
	});

	it("uses the topmost Authentication-Results header when more than one is present", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: multi-hop",
			"Authentication-Results: mx.example.com; dkim=pass header.d=example.com",
			"Authentication-Results: relay.upstream.example; dkim=pass header.d=spoofed.example",
			"",
			"body",
		]);
		const auth = extractAuthenticity(parsed);
		assert.ok(auth, "expected authenticity object");
		assert.equal(auth.dkimDomain, "example.com");
	});

	it("category and dkimMismatch agree when Authentication-Results and DKIM-Signature name the same domain", async () => {
		const parsed = await parse([
			"From: alice@personal.example.com",
			"To: bob@example.com",
			"Subject: forwarded",
			"Authentication-Results: mx.example.com; dkim=pass header.d=relay.example.net",
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

	it("category and dkimMismatch agree (aligned case)", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: aligned",
			"Authentication-Results: mx.example.com; dkim=pass header.d=example.com",
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

describe("extractAuthResult", () => {
	it("returns null when Authentication-Results header is absent", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: no auth-results",
			"",
			"body",
		]);
		assert.equal(extractAuthResult(parsed), null);
	});

	it("parses dmarc=pass spf=pass dkim=pass", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: auth results",
			"Authentication-Results: mx.example.com; dmarc=pass; spf=pass; dkim=pass",
			"",
			"body",
		]);
		const result = extractAuthResult(parsed);
		assert.ok(result);
		assert.equal(result.dmarc, "Pass");
		assert.equal(result.spf, "Pass");
		assert.equal(result.dkim, "Pass");
	});

	it("parses dmarc=fail", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: auth results",
			"Authentication-Results: mx.example.com; dmarc=fail",
			"",
			"body",
		]);
		const result = extractAuthResult(parsed);
		assert.ok(result);
		assert.equal(result.dmarc, "Fail");
	});

	it("returns undefined for mechanism when absent", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: partial",
			"Authentication-Results: mx.example.com; spf=softfail",
			"",
			"body",
		]);
		const result = extractAuthResult(parsed);
		assert.ok(result);
		assert.equal(result.spf, "Softfail");
		assert.equal(result.dmarc, undefined);
		assert.equal(result.dkim, undefined);
	});
});

describe("extractProviderSpam", () => {
	it("returns null when no spam headers are present", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: clean",
			"",
			"body",
		]);
		assert.equal(extractProviderSpam(parsed), null);
	});

	it("parses X-SpamExperts-Class: ham as classified=false", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: spamexperts ham",
			"X-SpamExperts-Class: ham",
			"",
			"body",
		]);
		const result = extractProviderSpam(parsed);
		assert.ok(result);
		assert.equal(result.classified, false);
		assert.equal(result.source, "x-spamexperts-class");
	});

	it("parses X-SpamExperts-Class: spam as classified=true", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: spamexperts spam",
			"X-SpamExperts-Class: spam",
			"",
			"body",
		]);
		const result = extractProviderSpam(parsed);
		assert.ok(result);
		assert.equal(result.classified, true);
		assert.equal(result.source, "x-spamexperts-class");
	});

	it("parses X-Spam-Status: Yes with score", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: spam status",
			"X-Spam-Status: Yes, score=8.4 required=5.0",
			"",
			"body",
		]);
		const result = extractProviderSpam(parsed);
		assert.ok(result);
		assert.equal(result.classified, true);
		assert.equal(result.score, "8.4");
		assert.equal(result.source, "x-spam-status");
	});

	it("parses X-Spam-Status: No as classified=false", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: not spam",
			"X-Spam-Status: No, score=1.2",
			"",
			"body",
		]);
		const result = extractProviderSpam(parsed);
		assert.ok(result);
		assert.equal(result.classified, false);
	});
});

describe("extractHasListUnsubscribe", () => {
	it("returns false when no List-Unsubscribe header", async () => {
		const parsed = await parse([
			"From: alice@example.com",
			"To: bob@example.com",
			"Subject: personal",
			"",
			"body",
		]);
		assert.equal(extractHasListUnsubscribe(parsed), false);
	});

	it("returns true when List-Unsubscribe header is present", async () => {
		const parsed = await parse([
			"From: newsletter@example.com",
			"To: bob@example.com",
			"Subject: our newsletter",
			"List-Unsubscribe: <https://example.com/unsubscribe>",
			"",
			"body",
		]);
		assert.equal(extractHasListUnsubscribe(parsed), true);
	});
});
