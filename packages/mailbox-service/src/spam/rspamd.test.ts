import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { describe, it } from "node:test";
import type { SpamRequest } from "@remit/data-ports";
import { fromRspamd, RspamdSpamService } from "./rspamd.js";

const symbol = (score: number, options: string[] = []) => ({
	score,
	options,
});

describe("fromRspamd", () => {
	const cases = [
		{
			action: "no action",
			score: -1.1,
			symbols: { R_SPF_ALLOW: symbol(-0.2) },
			expected: {
				score: 0,
				action: "None",
				kind: "Spam",
				reasons: [["BackendSymbol", "R_SPF_ALLOW"]],
			},
		},
		{
			action: "greylist",
			score: 4.5,
			symbols: { REPLYTO_DOM_NEQ_FROM_DOM: symbol(2.5) },
			expected: {
				score: 0.3,
				action: "Warn",
				kind: "Spam",
				reasons: [["ReplyToMismatch", "REPLYTO_DOM_NEQ_FROM_DOM"]],
			},
		},
		{
			action: "add header",
			score: 7.5,
			symbols: { PHISHING: symbol(4.5, ["bank.example->login.example.net"]) },
			expected: {
				score: 0.5,
				action: "Warn",
				kind: "Phishing",
				reasons: [["LinkTextMismatch", "PHISHING"]],
			},
		},
		{
			action: "rewrite subject",
			score: 9,
			symbols: { DMARC_POLICY_SOFTFAIL: symbol(0.1), BAYES_SPAM: symbol(5.1) },
			expected: {
				score: 0.6,
				action: "Warn",
				kind: "Spam",
				reasons: [
					["DmarcFail", "DMARC_POLICY_SOFTFAIL"],
					["BackendSymbol", "BAYES_SPAM"],
				],
			},
		},
		{
			action: "soft reject",
			score: 12,
			symbols: { FUZZY_DENIED: symbol(12) },
			expected: {
				score: 0.8,
				action: "Warn",
				kind: "Spam",
				reasons: [["BackendSymbol", "FUZZY_DENIED"]],
			},
		},
		{
			action: "reject",
			score: 21.3,
			symbols: {
				PHISHED_OPENPHISH: symbol(7),
				SPOOF_DISPLAY_NAME: symbol(8),
				OMOGRAPH_URL: symbol(4.3),
			},
			expected: {
				score: 1,
				action: "Junk",
				kind: "Phishing",
				reasons: [
					["ListedPhishingLink", "PHISHED_OPENPHISH"],
					["DisplayNameForeignAddress", "SPOOF_DISPLAY_NAME"],
					["MixedScriptDomain", "OMOGRAPH_URL"],
				],
			},
		},
		{
			action: "discard",
			score: 16,
			symbols: { BAYES_SPAM: symbol(5.1) },
			expected: {
				score: 1,
				action: "Junk",
				kind: "Spam",
				reasons: [["BackendSymbol", "BAYES_SPAM"]],
			},
		},
		{
			action: "quarantine",
			score: 14,
			symbols: { DMARC_POLICY_QUARANTINE: symbol(1.5) },
			expected: {
				score: 14 / 15,
				action: "Junk",
				kind: "Spam",
				reasons: [["DmarcFail", "DMARC_POLICY_QUARANTINE"]],
			},
		},
	];

	for (const { action, score, symbols, expected } of cases) {
		it(`maps ${action} to ${expected.action}`, () => {
			const response = fromRspamd({
				score,
				required_score: 15,
				action,
				symbols,
			});
			assert.equal(response.state, "Checked");
			if (response.state !== "Checked") return;
			assert.deepEqual(
				{
					score: response.score,
					action: response.action,
					kind: response.kind,
					reasons: response.reasons.map((reason) => [
						reason.name,
						reason.symbol,
					]),
				},
				expected,
			);
		});
	}

	it("keeps a symbol's score and options", () => {
		const response = fromRspamd({
			score: 7.5,
			required_score: 15,
			action: "add header",
			symbols: { PHISHING: symbol(4.5, ["bank.example->login.example.net"]) },
		});
		assert.equal(response.state, "Checked");
		if (response.state !== "Checked") return;
		assert.deepEqual(response.reasons, [
			{
				name: "LinkTextMismatch",
				symbol: "PHISHING",
				score: 4.5,
				options: ["bank.example->login.example.net"],
			},
		]);
	});

	it("reads an unknown action or a malformed symbol as Unparseable", () => {
		const unparseable = { state: "Failed", kind: "Unparseable" };
		assert.deepEqual(
			fromRspamd({
				score: 1,
				required_score: 15,
				action: "shrug",
				symbols: {},
			}),
			unparseable,
		);
		assert.deepEqual(
			fromRspamd({
				score: 1,
				required_score: 15,
				action: "reject",
				symbols: { BAYES_SPAM: { score: "5" } },
			}),
			unparseable,
		);
		assert.deepEqual(fromRspamd(undefined), unparseable);
	});

	it("reads a skipped message as a service error", () => {
		assert.deepEqual(
			fromRspamd({
				is_skipped: true,
				score: 0,
				required_score: 15,
				action: "no action",
				symbols: {},
			}),
			{ state: "Failed", kind: "ServiceError" },
		);
	});
});

describe("RspamdSpamService", () => {
	it("posts the raw message to /checkv2 with the envelope as headers", async () => {
		const seen: { url?: string; headers?: IncomingHttpHeaders; body?: string } =
			{};
		const server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => {
				seen.url = req.url;
				seen.headers = req.headers;
				seen.body = Buffer.concat(chunks).toString("utf8");
				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
						score: 0,
						required_score: 15,
						action: "no action",
						symbols: {},
					}),
				);
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		assert.ok(address !== null && typeof address === "object");
		const raw = "From: ann@shop.example\r\nSubject: hi\r\n\r\nhello\r\n";
		const request: SpamRequest = {
			message: {
				raw: Buffer.from(raw).toString("base64"),
				headers: [],
				text: "hello",
				html: "",
				links: [],
			},
			envelope: {
				mailFrom: "bounce@shop.example",
				rcpt: ["me@home.example", "alias@home.example"],
				ip: "192.0.2.10",
				helo: "mx.shop.example",
				hostname: "mail.shop.example",
			},
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
				senderDomainMessagesSeen: 0,
				receivedAt: "2026-11-13T10:00:00Z",
				classifierScores: [],
				modelAllowed: false,
			},
		};

		const response = await new RspamdSpamService(
			`http://127.0.0.1:${address.port}`,
		).check(request);
		server.close();

		assert.equal(response.state, "Checked");
		assert.equal(seen.url, "/checkv2");
		assert.equal(seen.body, raw);
		assert.equal(seen.headers?.from, "bounce@shop.example");
		assert.equal(seen.headers?.rcpt, "me@home.example");
		assert.equal(seen.headers?.ip, "192.0.2.10");
		assert.equal(seen.headers?.helo, "mx.shop.example");
		assert.equal(seen.headers?.hostname, "mail.shop.example");
	});
});
