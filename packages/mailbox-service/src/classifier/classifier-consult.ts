import type { ClassifierScoreItem } from "@remit/data-ports";
import {
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import { SenderOverride } from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import { classifyWithProvider } from "./classifier-adapter.js";
import type { ClassificationFailureKindValue } from "./classifier-failure.js";
import {
	type ClassifierConfig,
	type ClassifierGate,
	classifierMessageOf,
} from "./classifier-gate.js";
import {
	type ClassifierVerdict,
	classifierVerdict,
	storedClassifierScores,
} from "./classifier-precedence.js";
import { CLASSIFIER_LABELS } from "./index.js";

export type ClassifierConsultation =
	| { state: "NotAsked" }
	| { state: "AtLimit" }
	| { state: "NoAnswer"; kind: ClassificationFailureKindValue }
	| {
			state: "Answered";
			verdict: ClassifierVerdict;
			scores: ClassifierScoreItem[];
	  };

type GateOn = Extract<ClassifierGate, { state: "On" }>;

/** One unit of the account's daily model cap, shared by the category classifier and the spam model. */
export const claimClassifierCall = async (
	config: {
		accountSetting: Pick<ClassifierConfig["accountSetting"], "claimDailyCount">;
	},
	gate: Pick<GateOn, "dailyLimit">,
	account: { accountId: string; accountConfigId: string },
	now: number,
): Promise<boolean> => {
	const claim = await config.accountSetting.claimDailyCount({
		accountConfigId: account.accountConfigId,
		name: classificationUsageName(account.accountId),
		date: utcDateOf(now),
		limit: gate.dailyLimit,
	});
	return claim.state !== "AtLimit";
};

export const consultClassifier = async (
	config: ClassifierConfig,
	gate: ClassifierGate,
	account: { accountId: string; accountConfigId: string },
	parsed: ParsedMail,
	senderOverride: (typeof SenderOverride)[keyof typeof SenderOverride],
	now: number,
): Promise<ClassifierConsultation> => {
	if (gate.state === "Off" || senderOverride !== SenderOverride.None) {
		return { state: "NotAsked" };
	}
	if (!(await claimClassifierCall(config, gate, account, now))) {
		return { state: "AtLimit" };
	}
	const result = await classifyWithProvider(
		{
			provider: gate.provider,
			labels: CLASSIFIER_LABELS,
			message: classifierMessageOf(parsed),
		},
		{ logger: config.logger },
	);
	if (!result.ok) return { state: "NoAnswer", kind: result.kind };
	const answer = {
		scores: result.scores,
		confidenceKind: result.confidenceKind,
	};
	return {
		state: "Answered",
		verdict: classifierVerdict(answer),
		scores: storedClassifierScores(answer),
	};
};
