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
import { classifierMayJunk } from "./placement.js";

const UNSET: SpamPipeline = [
	{ name: SpamJudgeName.Inline, thresholds: { state: "Unset" } },
];

const CALIBRATED: SpamPipeline = [
	{
		name: SpamJudgeName.Inline,
		thresholds: { state: "Set", cleanBelow: 0.3, spamAt: 0.9 },
	},
];

const checked: MessageSpamVerdict = {
	state: "Checked",
	score: 0.2,
	action: SpamAction.None,
	kind: SpamKind.Spam,
	reasons: [],
	modelOutcome: SpamModelOutcome.OutOfBand,
	decidedBy: SpamJudgeName.Inline,
};

const stranger = { knownSender: false };

describe("the classifier's own junk move", () => {
	it("yields to a screened-out newsletter", () => {
		const screened: MessageSpamVerdict = {
			state: "ScreenedOut",
			screen: { rule: SpamSenderScreenRule.Newsletter },
		};
		assert.equal(classifierMayJunk(screened, stranger, UNSET), false);
	});

	it("yields to a sender the owner has written to", () => {
		assert.equal(
			classifierMayJunk(checked, { knownSender: true }, UNSET),
			false,
		);
	});

	it("yields to a calibrated judge's verdict", () => {
		assert.equal(classifierMayJunk(checked, stranger, CALIBRATED), false);
	});

	it("still moves a stranger's mail while the judge is uncalibrated", () => {
		assert.equal(classifierMayJunk(checked, stranger, UNSET), true);
	});
});
