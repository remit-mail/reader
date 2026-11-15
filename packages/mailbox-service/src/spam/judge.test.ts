import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpamRequest } from "@remit/data-ports";
import { SpamAction, SpamKind, SpamReasonName } from "@remit/domain-enums";
import { simpleParser } from "mailparser";
import * as tldts from "tldts";
import { looksGenerated, skeleton } from "./domains.js";
import { buildSpamRequest } from "./evidence.js";
import { actionOf, judge } from "./judge.js";

const request = (
	overrides: {
		from?: string;
		headers?: SpamRequest["message"]["headers"];
		links?: SpamRequest["message"]["links"];
		html?: string;
		context?: Partial<SpamRequest["context"]>;
	} = {},
): SpamRequest => ({
	message: {
		raw: "",
		headers: [
			{ name: "From", value: overrides.from ?? "Ann <ann@shop.example>" },
			...(overrides.headers ?? []),
		],
		text: "",
		html: overrides.html ?? "",
		links: overrides.links ?? [],
	},
	envelope: { mailFrom: "", rcpt: [], ip: "", helo: "", hostname: "" },
	authentication: {
		dmarc: "Pass",
		spf: "Pass",
		dkim: "Pass",
		signerDomain: "shop.example",
		envelopeDomain: "shop.example",
	},
	provider: { verdict: "Absent", score: "", headers: [] },
	context: {
		knownSender: false,
		senderMessagesSeen: 0,
		senderDomainMessagesSeen: 4,
		receivedAt: "2026-11-13T10:00:00Z",
		classifierScores: [],
		modelAllowed: false,
		...overrides.context,
	},
});

const UNSET = { state: "Unset" } as const;

const reasons = (spam: SpamRequest) =>
	judge(spam, UNSET, tldts).reasons.map((reason) => reason.name);

describe("the inline judge", () => {
	it("finds nothing in plain mail from a domain with history", () => {
		const verdict = judge(request(), UNSET, tldts);
		assert.deepEqual(verdict.reasons, []);
		assert.equal(verdict.score, 0);
		assert.equal(verdict.action, SpamAction.None);
	});

	it("flags a passing signature from another domain where DMARC gave no verdict", () => {
		const signed = request();
		signed.authentication.dmarc = "None";
		signed.authentication.signerDomain = "esp.example";
		const found = judge(signed, UNSET, tldts).reasons.find(
			(reason) => reason.name === SpamReasonName.SignerMismatch,
		);
		assert.deepEqual(found?.options, ["esp.example"]);
	});

	const SET = { state: "Set", cleanBelow: 0.3, spamAt: 0.9 } as const;

	const arrived = async (lines: string[]): Promise<SpamRequest> => {
		const raw = Buffer.from([...lines, "", "body"].join("\r\n"));
		return buildSpamRequest(
			await simpleParser(raw),
			raw,
			{
				rcpt: [],
				receivedAt: Date.parse("2026-11-13T10:00:00Z"),
				knownSender: false,
				senderMessagesSeen: 0,
				senderDomainMessagesSeen: 4,
				senderDomainRegisteredAt: undefined,
				classifierScores: [],
				modelAllowed: false,
			},
			tldts,
		);
	};

	const FROM = "From: Support <support@evil-mimic.example>";
	const RELAY_SIGNATURE =
		"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx";
	const OWN_SIGNATURE =
		"DKIM-Signature: v=1; a=rsa-sha256; d=evil-mimic.example; s=sel; b=xxx";
	const FORGED =
		"Authentication-Results: whatever; dkim=pass header.d=evil-mimic.example; dmarc=pass header.from=evil-mimic.example";
	const REAL = "Authentication-Results: mx.example.com; dmarc=fail";

	const failing: Record<string, string[]> = {
		"a failing DKIM signature": [
			FROM,
			OWN_SIGNATURE,
			"Authentication-Results: mx.example.com; dkim=fail header.d=evil-mimic.example; dmarc=fail",
		],
		"a signature from another domain": [FROM, RELAY_SIGNATURE, REAL],
		"a forged passing result after the receiver's": [
			REAL,
			FORGED,
			FROM,
			RELAY_SIGNATURE,
		],
	};

	for (const [label, lines] of Object.entries(failing)) {
		it(`sends a DMARC fail with ${label} to Junk at a spamAt of 0.9`, async () => {
			const verdict = judge(await arrived(lines), SET, tldts);
			assert.ok(
				verdict.reasons.some(
					(reason) => reason.name === SpamReasonName.DkimDmarcFail,
				),
			);
			assert.ok(verdict.score >= 0.9);
			assert.equal(verdict.action, SpamAction.Junk);
		});
	}

	const passing: Record<string, string[]> = {
		"a signature from another domain without a DMARC fail": [
			FROM,
			RELAY_SIGNATURE,
			"Authentication-Results: mx.example.com; dkim=pass header.d=relay.example.net; dmarc=pass",
		],
		"a failing DKIM signature without a DMARC fail": [
			FROM,
			OWN_SIGNATURE,
			"Authentication-Results: mx.example.com; dkim=fail header.d=evil-mimic.example; dmarc=pass",
		],
		"a DMARC fail with the sender's own passing signature": [
			FROM,
			OWN_SIGNATURE,
			"Authentication-Results: mx.example.com; dkim=pass header.d=evil-mimic.example; dmarc=fail",
		],
	};

	for (const [label, lines] of Object.entries(passing)) {
		it(`does not flag ${label}`, async () => {
			assert.ok(
				!reasons(await arrived(lines)).includes(SpamReasonName.DkimDmarcFail),
			);
		});
	}

	it("flags a punycode link domain", () => {
		assert.ok(
			reasons(
				request({
					links: [{ href: "https://xn--pple-43d.com/login", text: "Sign in" }],
				}),
			).includes(SpamReasonName.PunycodeDomain),
		);
	});

	it("flags a domain label that mixes Latin and Cyrillic", () => {
		assert.ok(
			reasons(
				request({
					links: [{ href: "https://shop.example", text: "pаypal.com" }],
				}),
			).includes(SpamReasonName.MixedScriptDomain),
		);
	});

	it("flags two different domains that share a skeleton", () => {
		const verdict = judge(
			request({
				from: "Bank <alerts@rnybank.example>",
				links: [{ href: "https://mybank.example/verify", text: "Verify" }],
			}),
			UNSET,
			tldts,
		);
		const found = verdict.reasons.find(
			(reason) => reason.name === SpamReasonName.ConfusableDomains,
		);
		assert.deepEqual(found?.options.sort(), [
			"mybank.example",
			"rnybank.example",
		]);
		assert.equal(verdict.kind, SpamKind.Phishing);
	});

	it("flags link text that shows another domain than the href", () => {
		const found = judge(
			request({
				links: [{ href: "https://collect.example/x", text: "www.example.com" }],
			}),
			UNSET,
			tldts,
		).reasons.find((reason) => reason.name === SpamReasonName.LinkTextMismatch);
		assert.deepEqual(found?.options, ["example.com -> collect.example"]);
	});

	it("ignores links for a sender with earlier mail", () => {
		assert.deepEqual(
			reasons(
				request({
					links: [
						{ href: "https://collect.example/x", text: "www.mybank.example" },
					],
					context: { senderMessagesSeen: 3 },
				}),
			),
			[],
		);
	});

	it("flags a sender local part that looks generated", () => {
		assert.ok(
			reasons(request({ from: "x7k2q9m4p8z3@shop.example" })).includes(
				SpamReasonName.GeneratedName,
			),
		);
	});

	const LIST_FROM = "From: Author <author@writer.example>";
	const LIST_SIGNATURE =
		"DKIM-Signature: v=1; a=rsa-sha256; d=lists.example.org; s=sel; b=xxx";
	const AUTHOR_SIGNATURE =
		"DKIM-Signature: v=1; a=rsa-sha256; d=writer.example; s=sel; b=xxx";

	const TRUSTED_SEAL =
		"ARC-Seal: i=1; a=rsa-sha256; d=google.com; s=arc; cv=none; b=xxx";
	const TRUSTED_SEALER_RESULTS =
		"ARC-Authentication-Results: i=1; mx.google.com; dkim=pass header.d=writer.example; dmarc=pass header.from=writer.example";

	it("does not read the broken DMARC of a forward a trusted sealer verified as forgery", async () => {
		const found = reasons(
			await arrived([
				"Authentication-Results: mx.google.com; arc=pass; dkim=fail header.d=writer.example; dmarc=fail",
				TRUSTED_SEAL,
				TRUSTED_SEALER_RESULTS,
				LIST_FROM,
				AUTHOR_SIGNATURE,
			]),
		);
		for (const name of [
			SpamReasonName.DmarcFail,
			SpamReasonName.DkimDmarcFail,
			SpamReasonName.SignerMismatch,
			SpamReasonName.ReplyToMismatch,
		]) {
			assert.ok(!found.includes(name), name);
		}
	});

	const forgedRelay: Record<string, string[]> = {
		"a List-Id whose list signature fails": [
			"Authentication-Results: mx.example.com; dkim=fail header.d=lists.example.org; dmarc=fail",
			FROM,
			"List-Id: <devs.lists.example.org>",
			LIST_SIGNATURE,
		],
		"a forged ARC chain the receiver is silent about": [
			"Authentication-Results: mx.google.com; dkim=fail header.d=writer.example; dmarc=fail",
			"Authentication-Results: forger.example; arc=pass",
			TRUSTED_SEAL,
			TRUSTED_SEALER_RESULTS,
			LIST_FROM,
			AUTHOR_SIGNATURE,
		],
		"a self-run relay with a List-Id and its own DKIM": [
			"Authentication-Results: mx.example.com; dkim=fail header.d=writer.example; dkim=pass header.d=lists.example.org; dmarc=fail",
			LIST_FROM,
			"List-Id: Devs <devs.lists.example.org>",
			"Reply-To: devs@lists.example.org",
			LIST_SIGNATURE,
			AUTHOR_SIGNATURE,
		],
	};

	for (const [label, lines] of Object.entries(forgedRelay)) {
		it(`still flags a DMARC fail with ${label}`, async () => {
			assert.ok(
				reasons(await arrived(lines)).includes(SpamReasonName.DkimDmarcFail),
			);
		});
	}

	const GMAIL_PASS = {
		name: "Authentication-Results",
		value: "mx.google.com; dkim=pass header.d=esp.example; dmarc=pass",
	};

	it("finds nothing to impersonation in a newsletter from a sender with earlier mail", () => {
		const newsletter = request({
			from: "Tech Weekly <communityupdates@techweekly.example>",
			headers: [
				GMAIL_PASS,
				{ name: "List-Unsubscribe", value: "<https://esp.example/u/1>" },
				{ name: "Reply-To", value: "redactie@support-desk.example" },
			],
			context: { senderMessagesSeen: 1 },
		});
		newsletter.authentication.signerDomain = "esp.example";
		const found = reasons(newsletter);
		for (const name of [
			SpamReasonName.SignerMismatch,
			SpamReasonName.ReplyToMismatch,
			SpamReasonName.GeneratedName,
		]) {
			assert.ok(!found.includes(name), name);
		}
	});

	it("flags a Reply-To on another domain from a first-time sender at a shared provider", () => {
		assert.ok(
			reasons(
				request({
					from: "Ann <ann.first@gmail.com>",
					headers: [
						GMAIL_PASS,
						{ name: "Reply-To", value: "payments@billing.example" },
					],
					context: { senderMessagesSeen: 0, senderDomainMessagesSeen: 500 },
				}),
			).includes(SpamReasonName.ReplyToMismatch),
		);
	});

	it("flags every domain in link text that differs from the link", () => {
		const found = judge(
			request({
				links: [
					{
						href: "https://secure-login.xyz/verify",
						text: "secure-login.xyz | paypal.com",
					},
				],
			}),
			UNSET,
			tldts,
		).reasons.find((reason) => reason.name === SpamReasonName.LinkTextMismatch);
		assert.deepEqual(found?.options, ["paypal.com -> secure-login.xyz"]);
	});

	it("does not take a project name in link text for a domain", () => {
		assert.ok(
			!reasons(
				request({
					links: [{ href: "https://collect.example/x", text: "Next.js" }],
				}),
			).includes(SpamReasonName.LinkTextMismatch),
		);
	});

	it("flags link text that names another domain inside a sentence", () => {
		const found = judge(
			request({
				links: [
					{
						href: "https://evil.example/login",
						text: "Sign in to example.com",
					},
				],
			}),
			UNSET,
			tldts,
		).reasons.find((reason) => reason.name === SpamReasonName.LinkTextMismatch);
		assert.deepEqual(found?.options, ["example.com -> evil.example"]);
	});

	it("flags a punycode domain that differs from an ASCII one by an accent", () => {
		assert.ok(
			reasons(
				request({
					links: [{ href: "https://xn--paypl-0qa.com/login", text: "Log in" }],
				}),
			).includes(SpamReasonName.PunycodeDomain),
		);
	});

	it("does not flag an internationalised domain that imitates no ASCII one", () => {
		const found = reasons(
			request({
				links: [{ href: "https://xn--cck2b3b.example/", text: "Shop" }],
				context: { senderMessagesSeen: 2 },
			}),
		);
		assert.ok(!found.includes(SpamReasonName.PunycodeDomain));
		assert.ok(!found.includes(SpamReasonName.MixedScriptDomain));
	});

	it("does not read an accented Latin domain as mixed scripts", () => {
		assert.ok(
			!reasons(
				request({
					links: [{ href: "https://xn--caf-dma.nl/menu", text: "Menu" }],
				}),
			).includes(SpamReasonName.MixedScriptDomain),
		);
	});

	it("does not flag a Japanese label mixing Han and kana", () => {
		assert.ok(
			!reasons(
				request({
					links: [{ href: "https://shop.example", text: "東京ストア.jp" }],
				}),
			).includes(SpamReasonName.MixedScriptDomain),
		);
	});

	it("flags a domain registered shortly before the mail arrived", () => {
		assert.ok(
			reasons(
				request({
					context: { senderDomainRegisteredAt: "2026-11-01T00:00:00Z" },
				}),
			).includes(SpamReasonName.RecentlyRegisteredDomain),
		);
	});
});

describe("domain helpers", () => {
	it("folds lookalike letters and shapes into one skeleton", () => {
		assert.equal(skeleton("rnybank.example"), skeleton("mybank.example"));
		assert.equal(skeleton("аpple.example"), skeleton("apple.example"));
		assert.notEqual(skeleton("mail.example"), skeleton("mall.example"));
	});

	it("reads a shuffled run of letters and digits as generated, and words as not", () => {
		assert.equal(looksGenerated("a8f3k2l9x7q1"), true);
		assert.equal(looksGenerated("notifications"), false);
		assert.equal(looksGenerated("jan.devries"), false);
		assert.equal(looksGenerated("communityupdates"), false);
		assert.equal(looksGenerated("xkqvbzmtplwd"), true);
	});
});

describe("score to action", () => {
	const set = { state: "Set", cleanBelow: 0.3, spamAt: 0.8 } as const;

	it("takes no action while the thresholds are unset", () => {
		assert.equal(actionOf(0.99, UNSET), SpamAction.None);
	});

	it("leaves a score below cleanBelow alone", () => {
		assert.equal(actionOf(0.29, set), SpamAction.None);
	});

	it("warns between the thresholds", () => {
		assert.equal(actionOf(0.3, set), SpamAction.Warn);
		assert.equal(actionOf(0.79, set), SpamAction.Warn);
	});

	it("moves to Junk from spamAt up", () => {
		assert.equal(actionOf(0.8, set), SpamAction.Junk);
	});
});
