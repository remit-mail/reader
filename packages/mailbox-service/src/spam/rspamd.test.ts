import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fromRspamd } from "./rspamd.js";

const fixture = (name: string): unknown =>
	JSON.parse(
		readFileSync(new URL(`./fixtures/rspamd/${name}.json`, import.meta.url), {
			encoding: "utf8",
		}),
	);

describe("fromRspamd", () => {
	it("maps no action to None and floors a negative score at 0", () => {
		const response = fromRspamd(fixture("no-action"));
		assert.equal(response.state, "Checked");
		if (response.state !== "Checked") return;
		assert.equal(response.score, 0);
		assert.equal(response.action, "None");
		assert.equal(response.kind, "Spam");
		assert.deepEqual(
			response.reasons.find((reason) => reason.symbol === "ARC_NA"),
			{ name: "BackendSymbol", symbol: "ARC_NA", score: 0, options: [] },
		);
		assert.equal(response.modelCalled, false);
	});

	it("maps greylist to Warn and a Reply-To mismatch to its reason", () => {
		assert.deepEqual(fromRspamd(fixture("greylist")), {
			state: "Checked",
			score: 0.3,
			action: "Warn",
			kind: "Spam",
			reasons: [
				{
					name: "ReplyToMismatch",
					symbol: "REPLYTO_DOM_NEQ_FROM_DOM",
					score: 2.5,
					options: [],
				},
				{
					name: "BackendSymbol",
					symbol: "FREEMAIL_REPLYTO",
					score: 2,
					options: ["example.org"],
				},
			],
			modelCalled: false,
		});
	});

	it("maps add header to Junk and a phished link to phishing", () => {
		const response = fromRspamd(fixture("add-header"));
		assert.equal(response.state, "Checked");
		if (response.state !== "Checked") return;
		assert.equal(response.score, 0.5);
		assert.equal(response.action, "Junk");
		assert.equal(response.kind, "Phishing");
		assert.deepEqual(response.reasons[0], {
			name: "LinkTextMismatch",
			symbol: "PHISHING",
			score: 4.5,
			options: ["bank.example->login.example.net"],
		});
	});

	it("maps rewrite subject to Warn and a DMARC softfail to DmarcFail", () => {
		const response = fromRspamd(fixture("rewrite-subject"));
		assert.equal(response.state, "Checked");
		if (response.state !== "Checked") return;
		assert.equal(response.score, 0.6);
		assert.equal(response.action, "Warn");
		assert.equal(response.kind, "Spam");
		assert.deepEqual(
			response.reasons.map((reason) => [reason.name, reason.symbol]),
			[
				["BackendSymbol", "BAYES_SPAM"],
				["DmarcFail", "DMARC_POLICY_SOFTFAIL"],
				["BackendSymbol", "SUBJ_ALL_CAPS"],
			],
		);
	});

	it("maps soft reject to Warn", () => {
		const response = fromRspamd(fixture("soft-reject"));
		assert.equal(response.state, "Checked");
		if (response.state !== "Checked") return;
		assert.equal(response.score, 0.8);
		assert.equal(response.action, "Warn");
	});

	it("maps reject to Junk, caps the score at 1 and names the impersonation", () => {
		const response = fromRspamd(fixture("reject"));
		assert.equal(response.state, "Checked");
		if (response.state !== "Checked") return;
		assert.equal(response.score, 1);
		assert.equal(response.action, "Junk");
		assert.equal(response.kind, "Phishing");
		assert.deepEqual(
			response.reasons.map((reason) => [reason.name, reason.symbol]),
			[
				["DmarcFail", "DMARC_POLICY_REJECT"],
				["BackendSymbol", "PHISHED_OPENPHISH"],
				["DisplayNameForeignAddress", "SPOOF_DISPLAY_NAME"],
				["MixedScriptDomain", "OMOGRAPH_URL"],
			],
		);
	});

	it("reads an unknown action or a malformed symbol as Unparseable", () => {
		const reject = fixture("reject");
		assert.ok(reject !== null && typeof reject === "object");
		assert.deepEqual(fromRspamd({ ...reject, action: "discard" }), {
			state: "Failed",
			kind: "Unparseable",
		});
		assert.deepEqual(
			fromRspamd({ ...reject, symbols: { BAYES_SPAM: { score: "5" } } }),
			{ state: "Failed", kind: "Unparseable" },
		);
		assert.deepEqual(fromRspamd(undefined), {
			state: "Failed",
			kind: "Unparseable",
		});
	});

	it("reads a skipped message as a service error", () => {
		const noAction = fixture("no-action");
		assert.ok(noAction !== null && typeof noAction === "object");
		assert.deepEqual(fromRspamd({ ...noAction, is_skipped: true }), {
			state: "Failed",
			kind: "ServiceError",
		});
	});
});
