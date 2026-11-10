import {
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import { SenderOverride } from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import { classifyWithProvider } from "./classifier-adapter.js";
import {
	type ClassifierConfig,
	type ClassifierGate,
	classifierMessageOf,
} from "./classifier-gate.js";
import {
	type ClassifierVerdict,
	classifierVerdict,
} from "./classifier-precedence.js";
import { CLASSIFIER_LABELS } from "./index.js";

export type ClassifierConsultation =
	| { state: "NotAsked" }
	| { state: "AtLimit" }
	| { state: "NoAnswer" }
	| { state: "Answered"; verdict: ClassifierVerdict };

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
	const claim = await config.accountSetting.claimDailyCount({
		accountConfigId: account.accountConfigId,
		name: classificationUsageName(account.accountId),
		date: utcDateOf(now),
		limit: gate.dailyLimit,
	});
	if (claim.state === "AtLimit") return { state: "AtLimit" };
	const result = await classifyWithProvider(
		{
			provider: gate.provider,
			labels: CLASSIFIER_LABELS,
			message: classifierMessageOf(parsed),
		},
		{ logger: config.logger },
	);
	if (!result.ok) return { state: "NoAnswer" };
	return {
		state: "Answered",
		verdict: classifierVerdict({
			scores: result.scores,
			confidenceKind: result.confidenceKind,
		}),
	};
};
