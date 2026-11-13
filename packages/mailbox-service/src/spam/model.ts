import type {
	SpamReason,
	SpamRequest,
	SpamResponse,
	SpamThresholds,
} from "@remit/data-ports";
import {
	ClassificationFailureKind,
	SpamAction,
	SpamFailureKind,
	SpamModelOutcome,
} from "@remit/domain-enums";
import {
	type ClassifierResult,
	type ClassifierScore,
	classifyWithProvider,
} from "../classifier/classifier-adapter.js";
import { claimClassifierCall } from "../classifier/classifier-consult.js";
import type { ClassificationFailureKindValue } from "../classifier/classifier-failure.js";
import type {
	ClassifierConfig,
	ClassifierGate,
} from "../classifier/classifier-gate.js";
import { type Checked, type ModelAnswer, withModelAnswer } from "./judge.js";

type Verdict = ModelAnswer["verdict"];

const SPAM_LABELS: readonly Verdict[] = ["Impersonation", "Spam", "Clean"];

type SpamModelConfig = {
	accountSetting: Pick<ClassifierConfig["accountSetting"], "claimDailyCount">;
	logger: ClassifierConfig["logger"];
};

/** The account's model, as stage 3 reaches it, or none. */
export type SpamModelAccess =
	| { state: "Off" }
	| {
			state: "On";
			gate: Pick<
				Extract<ClassifierGate, { state: "On" }>,
				"provider" | "dailyLimit"
			>;
			config: SpamModelConfig;
			account: { accountId: string; accountConfigId: string };
	  };

export const SPAM_MODEL_OFF: SpamModelAccess = { state: "Off" };

export const spamModelAccessOf = (
	config: SpamModelConfig | undefined,
	gate: ClassifierGate,
	account: { accountId: string; accountConfigId: string },
): SpamModelAccess =>
	config && gate.state === "On"
		? { state: "On", gate, config, account }
		: SPAM_MODEL_OFF;

const FAILURE_OF: Partial<
	Record<
		ClassificationFailureKindValue,
		(typeof SpamFailureKind)[keyof typeof SpamFailureKind]
	>
> = {
	[ClassificationFailureKind.Unreachable]: SpamFailureKind.Unreachable,
	[ClassificationFailureKind.TimedOut]: SpamFailureKind.TimedOut,
	[ClassificationFailureKind.Unparseable]: SpamFailureKind.Unparseable,
};

const findingsOf = (reasons: readonly SpamReason[]): string => {
	const lines = reasons.map((reason) =>
		reason.options.length === 0
			? `- ${reason.name}`
			: `- ${reason.name}: ${reason.options.join(", ")}`,
	);
	return `Findings:\n${lines.length === 0 ? "- none" : lines.join("\n")}`;
};

const answerOf = (
	result: Extract<ClassifierResult<Verdict>, { ok: true }>,
): ModelAnswer => {
	const top = result.scores.reduce<ClassifierScore<Verdict>>(
		(best, score) => (score.confidence > best.confidence ? score : best),
		result.scores[0],
	);
	const clean =
		result.scores.find((score) => score.label === "Clean")?.confidence ??
		1 - top.confidence;
	return { verdict: top.label, score: 1 - clean, reason: result.reason };
};

/**
 * Stage 3, run by Remit after the spam service answers: a `Warn` is the
 * ambiguous band, and gets one model call that claims a unit of the daily cap
 * the category classifier uses. Only a 429 is a skip; any other model failure
 * is the contract's `Failed`.
 */
export const consultSpamModel = async (
	access: SpamModelAccess,
	request: SpamRequest,
	response: SpamResponse,
	thresholds: SpamThresholds,
	now: number,
): Promise<SpamResponse> => {
	if (response.state !== "Checked") return response;
	if (response.action !== SpamAction.Warn || thresholds.state === "Unset") {
		return response;
	}
	const checked: Checked = response;
	if (access.state === "Off") {
		return { ...checked, modelOutcome: SpamModelOutcome.NotConfigured };
	}
	const { gate, config, account } = access;
	if (!(await claimClassifierCall(config, gate, account, now))) {
		return { ...checked, modelOutcome: SpamModelOutcome.DailyLimit };
	}
	const result = await classifyWithProvider(
		{
			provider: gate.provider,
			labels: SPAM_LABELS,
			message: {
				headers: request.message.headers,
				text: `${findingsOf(checked.reasons)}\n\n${request.message.text}`,
			},
		},
		{ logger: config.logger },
	);
	if (result.ok) return withModelAnswer(checked, answerOf(result), thresholds);
	if (result.kind === ClassificationFailureKind.RateLimited) {
		return { ...checked, modelOutcome: SpamModelOutcome.RateLimited };
	}
	return {
		state: "Failed",
		kind: FAILURE_OF[result.kind] ?? SpamFailureKind.ServiceError,
	};
};
