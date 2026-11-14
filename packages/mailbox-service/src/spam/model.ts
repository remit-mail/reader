import type {
	SpamReason,
	SpamRequest,
	SpamThresholds,
} from "@remit/data-ports";
import {
	ClassificationFailureKind,
	SpamFailureKind,
	SpamKind,
	SpamModelOutcome,
	SpamReasonName,
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
import { byThresholds, kindOf } from "./judge.js";
import type { Judgement, ModelJudged, SpamJudge } from "./pipeline.js";

/** What the model answered for a message. */
interface ModelAnswer {
	verdict: "Impersonation" | "Spam" | "Clean";
	score: number;
	reason: string;
}

type Verdict = ModelAnswer["verdict"];

const ANSWERED = {
	Impersonation: SpamReasonName.ModelImpersonation,
	Spam: SpamReasonName.ModelSpam,
	Clean: SpamReasonName.ModelClean,
} as const satisfies Record<Verdict, SpamReason["name"]>;

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
 * The model weighed against its own thresholds. Its score replaces the
 * earlier judges' scores, since it saw their reasons; an impersonation makes
 * the message `Phishing`.
 */
const judgedOf = (
	answer: ModelAnswer,
	earlier: readonly SpamReason[],
	thresholds: SpamThresholds,
): ModelJudged => {
	const score = Math.round(answer.score * 10_000) / 10_000;
	const name = ANSWERED[answer.verdict];
	return {
		state: "Judged",
		score,
		...byThresholds(score, thresholds),
		kind:
			answer.verdict === "Impersonation" ? SpamKind.Phishing : kindOf(earlier),
		reasons: [
			{
				name,
				symbol: name,
				score,
				options: answer.reason === "" ? [] : [answer.reason],
			},
		],
		modelOutcome: SpamModelOutcome.Answered,
	};
};

/**
 * Stage 3: one model call that claims a unit of the daily cap the category
 * classifier uses. The judge abstains for an account without a model, out of
 * calls, or refused for the provider's rate limit; any other model failure is
 * the contract's `Failed`. Remit passes the account's model and the time.
 */
export class ModelJudge implements SpamJudge {
	constructor(
		private readonly thresholds: SpamThresholds,
		private readonly access: SpamModelAccess,
		private readonly now: number,
	) {}

	async check(
		request: SpamRequest,
		earlier: readonly SpamReason[],
	): Promise<Judgement> {
		if (this.access.state === "Off") {
			return {
				state: "Abstained",
				modelOutcome: SpamModelOutcome.NotConfigured,
			};
		}
		const { gate, config, account } = this.access;
		if (!(await claimClassifierCall(config, gate, account, this.now))) {
			return { state: "Abstained", modelOutcome: SpamModelOutcome.DailyLimit };
		}
		const result = await classifyWithProvider(
			{
				provider: gate.provider,
				labels: SPAM_LABELS,
				message: {
					headers: request.message.headers,
					text: `${findingsOf(earlier)}\n\n${request.message.text}`,
				},
			},
			{ logger: config.logger },
		);
		if (result.ok) return judgedOf(answerOf(result), earlier, this.thresholds);
		if (result.kind === ClassificationFailureKind.RateLimited) {
			return { state: "Abstained", modelOutcome: SpamModelOutcome.RateLimited };
		}
		return {
			state: "Failed",
			kind: FAILURE_OF[result.kind] ?? SpamFailureKind.ServiceError,
		};
	}
}
