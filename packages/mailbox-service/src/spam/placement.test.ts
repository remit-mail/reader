import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageSpamVerdict, SpamPipeline } from "@remit/data-ports";
import {
	SpamAction,
	SpamJudgeName,
	SpamKind,
	SpamModelOutcome,
	SpamSenderScreenRule,
} from "@remit/domain-enums";
import { classifierMayJunk, spamClearsJunk } from "./placement.js";

const UNSET: SpamPipeline = [
	{ name: SpamJudgeName.Inline, thresholds: { state: "Unset" } },
];

const CALIBRATED: SpamPipeline = [
	{
		name: SpamJudgeName.Inline,
		thresholds: { state: "Set", cleanBelow: 0.3, spamAt: 0.9 },
	},
];

const checked: Extract<MessageSpamVerdict, { state: "Checked" }> = {
	state: "Checked",
	score: 0.2,
	action: SpamAction.None,
	kind: SpamKind.Spam,
	reasons: [],
	modelOutcome: SpamModelOutcome.OutOfBand,
	decidedBy: SpamJudgeName.Inline,
};

describe("the classifier's own junk move", () => {
	it("yields to a screened-out newsletter", () => {
		const screened: MessageSpamVerdict = {
			state: "ScreenedOut",
			screen: { rule: SpamSenderScreenRule.Newsletter },
		};
		assert.equal(classifierMayJunk(screened, UNSET), false);
	});

	it("yields to a calibrated judge's verdict", () => {
		assert.equal(classifierMayJunk(checked, CALIBRATED), false);
	});

	it("still moves mail while the judge is uncalibrated", () => {
		assert.equal(classifierMayJunk(checked, UNSET), true);
	});
});

describe("leaving Junk (issue #1428)", () => {
	const screenedBy = (
		rule: (typeof SpamSenderScreenRule)[keyof typeof SpamSenderScreenRule],
	): MessageSpamVerdict => ({ state: "ScreenedOut", screen: { rule } });

	it("clears a newsletter and a sender the owner knows or trusts", () => {
		for (const rule of [
			SpamSenderScreenRule.Newsletter,
			SpamSenderScreenRule.KnownSender,
			SpamSenderScreenRule.WellKnown,
			SpamSenderScreenRule.Vip,
			SpamSenderScreenRule.NeverSpam,
		]) {
			assert.equal(spamClearsJunk(screenedBy(rule), UNSET), true, rule);
		}
	});

	it("keeps a reported sender and a filter match", () => {
		assert.equal(
			spamClearsJunk(screenedBy(SpamSenderScreenRule.ReportedSender), UNSET),
			false,
		);
		assert.equal(
			spamClearsJunk(
				{ state: "ScreenedOut", screen: { rule: "Filter", filterId: "f-1" } },
				UNSET,
			),
			false,
		);
	});

	it("keeps mail the check never ran on", () => {
		assert.equal(spamClearsJunk({ state: "NotChecked" }, CALIBRATED), false);
	});

	it("clears a calibrated judge's clean verdict and keeps the rest", () => {
		assert.equal(spamClearsJunk(checked, CALIBRATED), true);
		assert.equal(spamClearsJunk({ ...checked, score: 0.5 }, CALIBRATED), false);
		assert.equal(
			spamClearsJunk({ ...checked, action: SpamAction.Junk }, CALIBRATED),
			false,
		);
	});

	it("keeps a verdict no judge decided", () => {
		assert.equal(spamClearsJunk(checked, UNSET), false);
	});
});
