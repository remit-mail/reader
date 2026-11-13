import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpamRequest } from "@remit/data-ports";
import { SpamAction, SpamKind, SpamReasonName } from "@remit/domain-enums";
import * as tldts from "tldts";
import { looksGenerated, skeleton } from "./domains.js";
import { actionOf, judge } from "./judge.js";

const request = (
	overrides: {
		from?: string;
		links?: SpamRequest["message"]["links"];
		html?: string;
		context?: Partial<SpamRequest["context"]>;
	} = {},
): SpamRequest => ({
	message: {
		raw: "",
		headers: [
			{ name: "From", value: overrides.from ?? "Ann <ann@shop.example>" },
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

	it("flags a passing signature from another domain than the sender's", () => {
		const signed = request();
		signed.authentication.signerDomain = "esp.example";
		const found = judge(signed, UNSET, tldts).reasons.find(
			(reason) => reason.name === SpamReasonName.SignerMismatch,
		);
		assert.deepEqual(found?.options, ["esp.example"]);
	});

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
				links: [
					{ href: "https://collect.example/x", text: "www.mybank.example" },
				],
			}),
			UNSET,
			tldts,
		).reasons.find((reason) => reason.name === SpamReasonName.LinkTextMismatch);
		assert.deepEqual(found?.options, ["mybank.example -> collect.example"]);
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
