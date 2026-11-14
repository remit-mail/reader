import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpamReason, SpamRequest } from "@remit/data-ports";
import {
	SpamAction,
	SpamFailureKind,
	SpamKind,
	SpamModelOutcome,
	SpamReasonName,
} from "@remit/domain-enums";
import {
	type Judgement,
	type SpamJudge,
	SpamPipelineService,
	type SpamStage,
} from "./pipeline.js";

const REQUEST: SpamRequest = {
	message: { raw: "", headers: [], text: "", html: "", links: [] },
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
		senderDomainMessagesSeen: 0,
		receivedAt: "2026-11-13T10:00:00Z",
		classifierScores: [],
		modelAllowed: false,
	},
};

const reason = (symbol: string): SpamReason => ({
	name: SpamReasonName.BackendSymbol,
	symbol,
	score: 0.1,
	options: [],
});

const judged = (
	symbol: string,
	score: number,
	action: (typeof SpamAction)[keyof typeof SpamAction],
	decided: boolean,
): Judgement => ({
	state: "Judged",
	score,
	action,
	kind: SpamKind.Spam,
	reasons: [reason(symbol)],
	decided,
});

const recording = (
	calls: { symbol: string; earlier: string[] }[],
	symbol: string,
	judgement: Judgement,
): SpamJudge => ({
	check: async (_request, earlier) => {
		calls.push({ symbol, earlier: earlier.map((found) => found.symbol) });
		return judgement;
	},
});

const run = (stages: SpamStage[]) =>
	new SpamPipelineService(stages).check(REQUEST);

describe("the spam pipeline", () => {
	it("stops at the first judge that is sure", async () => {
		const calls: { symbol: string; earlier: string[] }[] = [];

		const verdict = await run([
			{
				name: "Inline",
				judge: recording(
					calls,
					"first",
					judged("first", 0.9, SpamAction.Junk, true),
				),
			},
			{
				name: "Rspamd",
				judge: recording(
					calls,
					"second",
					judged("second", 0, SpamAction.None, true),
				),
			},
		]);

		assert.deepEqual(calls, [{ symbol: "first", earlier: [] }]);
		assert.deepEqual(verdict, {
			state: "Checked",
			score: 0.9,
			action: SpamAction.Junk,
			kind: SpamKind.Spam,
			reasons: [reason("first")],
			modelOutcome: SpamModelOutcome.OutOfBand,
			decidedBy: "Inline",
		});
	});

	it("passes an unsure verdict on, keeping every judge's reasons", async () => {
		const calls: { symbol: string; earlier: string[] }[] = [];

		const verdict = await run([
			{
				name: "Inline",
				judge: recording(
					calls,
					"first",
					judged("first", 0.5, SpamAction.Warn, false),
				),
			},
			{
				name: "Rspamd",
				judge: recording(
					calls,
					"second",
					judged("second", 0.1, SpamAction.None, true),
				),
			},
		]);

		assert.deepEqual(calls, [
			{ symbol: "first", earlier: [] },
			{ symbol: "second", earlier: ["first"] },
		]);
		assert.equal(verdict.state, "Checked");
		if (verdict.state !== "Checked") return;
		assert.equal(verdict.score, 0.1);
		assert.equal(verdict.action, SpamAction.None);
		assert.equal(verdict.decidedBy, "Rspamd");
		assert.deepEqual(
			verdict.reasons.map((found) => found.symbol),
			["first", "second"],
		);
	});

	it("keeps the last unsure verdict when no judge is sure", async () => {
		const verdict = await run([
			{
				name: "Rspamd",
				judge: recording(
					[],
					"only",
					judged("only", 0.4, SpamAction.Warn, false),
				),
			},
		]);

		assert.equal(
			verdict.state === "Checked" && verdict.action,
			SpamAction.Warn,
		);
		assert.equal(
			verdict.state === "Checked" && verdict.modelOutcome,
			SpamModelOutcome.NotConfigured,
		);
	});

	it("ends with a judge's failure", async () => {
		const calls: { symbol: string; earlier: string[] }[] = [];

		const verdict = await run([
			{
				name: "Rspamd",
				judge: recording(calls, "first", {
					state: "Failed",
					kind: SpamFailureKind.Unreachable,
				}),
			},
			{
				name: "Inline",
				judge: recording(
					calls,
					"second",
					judged("second", 0, SpamAction.None, true),
				),
			},
		]);

		assert.deepEqual(verdict, {
			state: "Failed",
			kind: SpamFailureKind.Unreachable,
		});
		assert.equal(calls.length, 1);
	});
});
