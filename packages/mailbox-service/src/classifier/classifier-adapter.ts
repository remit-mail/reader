import {
	ClassificationAdapterShape,
	ClassificationFailureKind,
} from "@remit/domain-enums";
import {
	type ClassificationFailureKindValue,
	failureKindForStatus,
} from "./classifier-failure.js";
import {
	type ClassifierMessage,
	classifierRequestText,
	countTokens,
} from "./classifier-request.js";

export type ClassificationAdapterShapeValue =
	(typeof ClassificationAdapterShape)[keyof typeof ClassificationAdapterShape];

export type ClassifierConfidenceKind = "Calibrated" | "Advisory";

export interface ClassifierScore {
	label: string;
	confidence: number;
}

export interface ClassifierProvider {
	adapterShape: ClassificationAdapterShapeValue;
	baseUrl: string;
	model: string;
	apiKey: string;
}

export interface ClassifierCall {
	provider: ClassifierProvider;
	labels: readonly string[];
	message: ClassifierMessage;
}

export interface ClassifierLogger {
	warn(obj: Record<string, unknown>, msg: string): void;
}

export interface ClassifierDeps {
	logger: ClassifierLogger;
	timeoutMs?: number;
}

export type ClassifierResult =
	| {
			ok: true;
			scores: ClassifierScore[];
			confidenceKind: ClassifierConfidenceKind;
			inputTokens: number;
			latencyMs: number;
	  }
	| {
			ok: false;
			kind: ClassificationFailureKindValue;
			status?: number;
			latencyMs: number;
	  };

export const CLASSIFIER_TIMEOUT_MS = 10_000;

interface AdapterSpec {
	path(baseUrl: string): string;
	body(model: string, labels: readonly string[], text: string): unknown;
	read(answer: unknown): Promise<ClassifierScore[] | undefined>;
	confidenceKind: ClassifierConfidenceKind;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const scoreOf = (
	value: unknown,
	labelKey: string,
	confidenceKey: string,
): ClassifierScore | undefined => {
	if (!isRecord(value)) return undefined;
	const label = value[labelKey];
	const confidence = value[confidenceKey];
	if (typeof label !== "string" || typeof confidence !== "number") {
		return undefined;
	}
	return { label, confidence };
};

const scoresOf = (
	values: unknown,
	labelKey: string,
	confidenceKey: string,
): ClassifierScore[] | undefined => {
	if (!Array.isArray(values)) return undefined;
	const scores = values.map((value) => scoreOf(value, labelKey, confidenceKey));
	if (scores.some((score) => score === undefined)) return undefined;
	return scores.filter((score) => score !== undefined);
};

const INSTRUCTION =
	"Classify this email with exactly one of the given labels. Answer with the label and your confidence between 0 and 1.";

const chatCompletionsPath = (baseUrl: string): string =>
	/\/(v\d+[a-z0-9]*|openai)$/i.test(new URL(baseUrl).pathname)
		? "/chat/completions"
		: "/v1/chat/completions";

const parseJsonString = (text: string): Promise<unknown> =>
	Promise.resolve(text).then((raw): unknown => JSON.parse(raw));

const chatScores = async (
	answer: unknown,
): Promise<ClassifierScore[] | undefined> => {
	if (!isRecord(answer) || !Array.isArray(answer.choices)) return undefined;
	const [choice] = answer.choices;
	if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
	const { content } = choice.message;
	if (typeof content !== "string") return undefined;
	const parsed = await parseJsonString(content).catch(() => undefined);
	const score = scoreOf(parsed, "label", "confidence");
	return score ? [score] : undefined;
};

const ADAPTERS: Record<ClassificationAdapterShapeValue, AdapterSpec> = {
	[ClassificationAdapterShape.DecisionApi]: {
		path: () => "/v1/systemone",
		body: (model, labels, text) => ({
			model,
			question: INSTRUCTION,
			input: text,
			options: labels,
		}),
		read: async (answer) =>
			isRecord(answer)
				? scoresOf(answer.probabilities, "option", "probability")
				: undefined,
		confidenceKind: "Calibrated",
	},
	[ClassificationAdapterShape.ChatJsonSchema]: {
		path: chatCompletionsPath,
		body: (model, labels, text) => ({
			model,
			temperature: 0,
			messages: [
				{ role: "system", content: INSTRUCTION },
				{ role: "user", content: text },
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "classification",
					strict: true,
					schema: {
						type: "object",
						properties: {
							label: { type: "string", enum: labels },
							confidence: { type: "number", minimum: 0, maximum: 1 },
						},
						required: ["label", "confidence"],
						additionalProperties: false,
					},
				},
			},
		}),
		read: chatScores,
		confidenceKind: "Advisory",
	},
	[ClassificationAdapterShape.JinaClassify]: {
		path: () => "/v1/classify",
		body: (model, labels, text) => ({ model, input: [text], labels }),
		read: async (answer) => {
			if (!isRecord(answer) || !Array.isArray(answer.data)) return undefined;
			const [first] = answer.data;
			if (!isRecord(first)) return undefined;
			return scoresOf(first.predictions, "label", "score");
		},
		confidenceKind: "Advisory",
	},
};

const isTimeout = (error: unknown): boolean =>
	error instanceof DOMException &&
	(error.name === "TimeoutError" || error.name === "AbortError");

interface Failure {
	kind: ClassificationFailureKindValue;
	status?: number;
}

type Exchange =
	| { reached: true; answer: unknown }
	| ({ reached: false } & Failure);

const transportFailure = (error: unknown): Exchange => ({
	reached: false,
	kind: isTimeout(error)
		? ClassificationFailureKind.TimedOut
		: ClassificationFailureKind.Unreachable,
});

const exchange = (url: string, init: RequestInit): Promise<Exchange> =>
	fetch(url, init).then((response): Promise<Exchange> | Exchange => {
		if (!response.ok) {
			void response.body?.cancel();
			return {
				reached: false,
				kind: failureKindForStatus(response.status),
				status: response.status,
			};
		}
		return response.json().then(
			(answer: unknown): Exchange => ({ reached: true, answer }),
			(error: unknown): Exchange =>
				isTimeout(error)
					? transportFailure(error)
					: { reached: false, kind: ClassificationFailureKind.Unparseable },
		);
	}, transportFailure);

const validScores = (
	scores: ClassifierScore[] | undefined,
	labels: readonly string[],
): scores is ClassifierScore[] =>
	scores !== undefined &&
	scores.length > 0 &&
	scores.every(
		(score) =>
			labels.includes(score.label) &&
			score.confidence >= 0 &&
			score.confidence <= 1,
	);

const endpoint = (baseUrl: string, path: string): string =>
	`${baseUrl.replace(/\/+$/, "")}${path}`;

export const classifyWithProvider = async (
	call: ClassifierCall,
	deps: ClassifierDeps,
): Promise<ClassifierResult> => {
	const { provider, labels } = call;
	const adapter = ADAPTERS[provider.adapterShape];
	const text = classifierRequestText(call.message);
	const headers: Record<string, string> = {
		"content-type": "application/json",
		accept: "application/json",
	};
	if (provider.apiKey !== "") {
		headers.authorization = `Bearer ${provider.apiKey}`;
	}

	const started = performance.now();
	const settled = await exchange(
		endpoint(provider.baseUrl, adapter.path(provider.baseUrl)),
		{
			method: "POST",
			headers,
			body: JSON.stringify(adapter.body(provider.model, labels, text)),
			signal: AbortSignal.timeout(deps.timeoutMs ?? CLASSIFIER_TIMEOUT_MS),
		},
	);
	const latencyMs = Math.round(performance.now() - started);

	const scores = settled.reached
		? await adapter.read(settled.answer)
		: undefined;
	if (settled.reached && validScores(scores, labels)) {
		return {
			ok: true,
			scores,
			confidenceKind: adapter.confidenceKind,
			inputTokens: countTokens(text),
			latencyMs,
		};
	}

	const failure: Failure = settled.reached
		? { kind: ClassificationFailureKind.Unparseable }
		: settled;
	deps.logger.warn(
		{
			adapterShape: provider.adapterShape,
			baseUrl: provider.baseUrl,
			model: provider.model,
			kind: failure.kind,
			status: failure.status,
			latencyMs,
		},
		"classification provider call failed",
	);
	return {
		ok: false,
		kind: failure.kind,
		...(failure.status === undefined ? {} : { status: failure.status }),
		latencyMs,
	};
};
