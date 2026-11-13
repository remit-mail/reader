import type {
	SpamModel,
	SpamModelAnswer,
	SpamModelOutcome,
	SpamReason,
	SpamRequest,
} from "@remit/data-ports";
import {
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import {
	ClassificationAdapterShape,
	ClassificationFailureKind,
} from "@remit/domain-enums";
import type {
	ClassificationAdapterShapeValue,
	ClassifierProvider,
} from "../classifier/classifier-adapter.js";
import { failureKindForStatus } from "../classifier/classifier-failure.js";
import type {
	ClassifierConfig,
	ClassifierGate,
} from "../classifier/classifier-gate.js";
import { classifierRequestText } from "../classifier/classifier-request.js";

type Verdict = SpamModelAnswer["verdict"];

const MODEL_TIMEOUT_MS = 10_000;

const VERDICTS: readonly Verdict[] = ["Impersonation", "Spam", "Clean"];

const CRITERIA: Record<Verdict, string> = {
	Impersonation:
		"The message claims to come from an organisation the sender's domain does not belong to.",
	Spam: "The message is unsolicited bulk mail, a scam, or fraud.",
	Clean: "The message is legitimate mail.",
};

const INSTRUCTION =
	"Judge this email. Impersonation means it claims to come from an organisation the sender's domain does not belong to. Give a verdict, a spam score between 0 and 1, and one sentence naming your reason. The findings list what automatic checks found.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const verdictOf = (value: unknown): Verdict | undefined =>
	VERDICTS.find((verdict) => verdict === value);

const isScore = (value: unknown): value is number =>
	typeof value === "number" && value >= 0 && value <= 1;

const readChat = (answer: unknown): SpamModelAnswer | undefined => {
	if (!isRecord(answer) || !Array.isArray(answer.choices)) return undefined;
	const [choice] = answer.choices;
	if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
	const { content } = choice.message;
	if (typeof content !== "string") return undefined;
	const parsed: unknown = JSON.parse(content);
	if (!isRecord(parsed)) return undefined;
	const verdict = verdictOf(parsed.verdict);
	if (!verdict || !isScore(parsed.score)) return undefined;
	if (typeof parsed.reason !== "string") return undefined;
	return { verdict, score: parsed.score, reason: parsed.reason };
};

const readDecision = (answer: unknown): SpamModelAnswer | undefined => {
	if (!isRecord(answer) || !isRecord(answer.answers)) return undefined;
	const choice = answer.answers.verdict;
	if (!isRecord(choice) || !isRecord(choice.probabilities)) return undefined;
	const verdict = verdictOf(choice.choice);
	const clean = choice.probabilities.Clean;
	if (!verdict || !isScore(clean)) return undefined;
	return { verdict, score: 1 - clean, reason: CRITERIA[verdict] };
};

const readJina = (answer: unknown): SpamModelAnswer | undefined => {
	if (!isRecord(answer) || !Array.isArray(answer.data)) return undefined;
	const [first] = answer.data;
	if (!isRecord(first)) return undefined;
	const verdict = verdictOf(first.prediction);
	if (!verdict || !isScore(first.score)) return undefined;
	return {
		verdict,
		score: verdict === "Clean" ? 1 - first.score : first.score,
		reason: CRITERIA[verdict],
	};
};

interface ModelAdapter {
	path: string;
	body(model: string, text: string): unknown;
	read(answer: unknown): SpamModelAnswer | undefined;
}

const ADAPTERS: Record<ClassificationAdapterShapeValue, ModelAdapter> = {
	[ClassificationAdapterShape.DecisionApi]: {
		path: "/v1/systemone",
		body: (model, text) => ({
			model,
			state: text,
			questions: {
				verdict: {
					type: "choice",
					instructions: INSTRUCTION,
					criteria: CRITERIA,
				},
			},
		}),
		read: readDecision,
	},
	[ClassificationAdapterShape.ChatJsonSchema]: {
		path: "/chat/completions",
		body: (model, text) => ({
			model,
			temperature: 0,
			messages: [
				{ role: "system", content: INSTRUCTION },
				{ role: "user", content: text },
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "spam_verdict",
					strict: true,
					schema: {
						type: "object",
						properties: {
							verdict: { type: "string", enum: VERDICTS },
							score: { type: "number", minimum: 0, maximum: 1 },
							reason: { type: "string" },
						},
						required: ["verdict", "score", "reason"],
						additionalProperties: false,
					},
				},
			},
		}),
		read: readChat,
	},
	[ClassificationAdapterShape.JinaClassify]: {
		path: "/v1/classify",
		body: (model, text) => ({ model, input: [{ text }], labels: VERDICTS }),
		read: readJina,
	},
};

const promptOf = (
	request: SpamRequest,
	reasons: readonly SpamReason[],
): string => {
	const findings = reasons.map((reason) =>
		reason.options.length === 0
			? `- ${reason.name}`
			: `- ${reason.name}: ${reason.options.join(", ")}`,
	);
	const message = classifierRequestText({
		headers: request.message.headers,
		text: request.message.text,
	});
	return `Findings:\n${findings.length === 0 ? "- none" : findings.join("\n")}\n\n${message}`;
};

const askProvider = (
	provider: ClassifierProvider,
	text: string,
): Promise<SpamModelOutcome> => {
	const adapter = ADAPTERS[provider.adapterShape];
	const headers: Record<string, string> = {
		"content-type": "application/json",
		accept: "application/json",
	};
	if (provider.apiKey !== "") {
		headers.authorization = `Bearer ${provider.apiKey}`;
	}
	const failed: SpamModelOutcome = { state: "Skipped", cause: "Failed" };
	return fetch(`${provider.baseUrl.replace(/\/+$/, "")}${adapter.path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(adapter.body(provider.model, text)),
		signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
	}).then(
		(response): Promise<SpamModelOutcome> | SpamModelOutcome => {
			if (!response.ok) {
				void response.body?.cancel();
				return failureKindForStatus(response.status) ===
					ClassificationFailureKind.RateLimited
					? { state: "Skipped", cause: "RateLimited" }
					: failed;
			}
			return response
				.json()
				.then((answer: unknown) => adapter.read(answer))
				.then(
					(read): SpamModelOutcome =>
						read ? { state: "Answered", answer: read } : failed,
					() => failed,
				);
		},
		() => failed,
	);
};

export interface SpamModelAccount {
	accountId: string;
	accountConfigId: string;
}

/** Remit never asks the model for an account with none configured. */
export const NO_SPAM_MODEL: SpamModel = {
	ask: () =>
		Promise.reject(
			new Error("The spam service asked for a model the request disallowed"),
		),
};

/**
 * The account's classification model, offered to the spam service for stage
 * 3. Each call claims one unit of the daily cap the category classifier uses
 * before it reaches the provider.
 */
export const spamModelFor = (
	config: Pick<ClassifierConfig, "accountSetting" | "logger">,
	gate: ClassifierGate,
	account: SpamModelAccount,
): SpamModel => {
	if (gate.state === "Off") return NO_SPAM_MODEL;
	return {
		ask: async (request, reasons) => {
			const claim = await config.accountSetting.claimDailyCount({
				accountConfigId: account.accountConfigId,
				name: classificationUsageName(account.accountId),
				date: utcDateOf(Date.now()),
				limit: gate.dailyLimit,
			});
			if (claim.state === "AtLimit") {
				return { state: "Skipped", cause: "DailyLimit" };
			}
			const outcome = await askProvider(
				gate.provider,
				promptOf(request, reasons),
			);
			if (outcome.state === "Skipped") {
				config.logger.warn(
					{ model: gate.provider.model, cause: outcome.cause },
					"spam model call failed",
				);
			}
			return outcome;
		},
	};
};
