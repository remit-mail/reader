import {
	ClassificationAdapterShape,
	ClassificationFailureKind,
	type ClassificationLabel,
} from "@remit/domain-enums";
import {
	type ClassificationFailureKindValue,
	failureKindForStatus,
} from "./classifier-failure.js";
import {
	type ClassifierMessage,
	classifierRequestText,
	countWords,
} from "./classifier-request.js";

export type ClassificationAdapterShapeValue =
	(typeof ClassificationAdapterShape)[keyof typeof ClassificationAdapterShape];

export type ClassificationLabelValue =
	(typeof ClassificationLabel)[keyof typeof ClassificationLabel];

export type ClassifierConfidenceKind = "Calibrated" | "Advisory";

export interface ClassifierScore<L extends string = ClassificationLabelValue> {
	label: L;
	confidence: number;
}

export interface ClassifierProvider {
	adapterShape: ClassificationAdapterShapeValue;
	baseUrl: string;
	model: string;
	apiKey: string;
}

export interface ClassifierCall<L extends string = ClassificationLabelValue> {
	provider: ClassifierProvider;
	labels: readonly L[];
	message: ClassifierMessage;
}

export interface ClassifierLogger {
	warn(obj: Record<string, unknown>, msg: string): void;
}

export interface ClassifierDeps {
	logger: ClassifierLogger;
	timeoutMs?: number;
}

export type ClassifierResult<L extends string = ClassificationLabelValue> =
	| {
			ok: true;
			scores: ClassifierScore<L>[];
			reason: string;
			confidenceKind: ClassifierConfidenceKind;
			inputWords: number;
			latencyMs: number;
	  }
	| {
			ok: false;
			kind: ClassificationFailureKindValue;
			status?: number;
			latencyMs: number;
	  };

const CLASSIFIER_TIMEOUT_MS = 10_000;

type Labels = readonly string[];

interface Answer {
	scores: ClassifierScore<string>[];
	reason: string;
}

interface AdapterSpec {
	path: string;
	body(model: string, labels: Labels, text: string): unknown;
	read(answer: unknown, labels: Labels): Answer | undefined;
	confidenceKind: ClassifierConfidenceKind;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const score = (
	label: unknown,
	confidence: unknown,
	labels: Labels,
): ClassifierScore<string> | undefined => {
	const known = labels.find((candidate) => candidate === label);
	if (known === undefined || typeof confidence !== "number") return undefined;
	if (confidence < 0 || confidence > 1) return undefined;
	return { label: known, confidence };
};

const DECISION_QUESTION = "label";

const DECISION_INSTRUCTION = "Which label fits this email best?";

const CHAT_INSTRUCTION =
	"Classify this email with exactly one of the given labels. Answer with the label and your confidence between 0 and 1.";

const readDecision = (answer: unknown, labels: Labels): Answer | undefined => {
	if (!isRecord(answer) || !isRecord(answer.answers)) return undefined;
	const choice = answer.answers[DECISION_QUESTION];
	if (!isRecord(choice) || choice.type !== "choice") return undefined;
	if (!isRecord(choice.probabilities)) return undefined;
	if (score(choice.choice, choice.confidence, labels) === undefined) {
		return undefined;
	}
	const scores = Object.entries(choice.probabilities).map(
		([label, probability]) => score(label, probability, labels),
	);
	const known = scores.filter((entry) => entry !== undefined);
	return known.length === scores.length
		? { scores: known, reason: "" }
		: undefined;
};

const readChat = (answer: unknown, labels: Labels): Answer | undefined => {
	if (!isRecord(answer) || !Array.isArray(answer.choices)) return undefined;
	const [choice] = answer.choices;
	if (!isRecord(choice) || !isRecord(choice.message)) return undefined;
	const { content } = choice.message;
	if (typeof content !== "string") return undefined;
	const parsed: unknown = JSON.parse(content);
	if (!isRecord(parsed)) return undefined;
	const chosen = score(parsed.label, parsed.confidence, labels);
	if (!chosen) return undefined;
	return {
		scores: [chosen],
		reason: typeof parsed.reason === "string" ? parsed.reason : "",
	};
};

const readJina = (answer: unknown, labels: Labels): Answer | undefined => {
	if (!isRecord(answer) || !Array.isArray(answer.data)) return undefined;
	const [first] = answer.data;
	if (!isRecord(first)) return undefined;
	const chosen = score(first.prediction, first.score, labels);
	return chosen ? { scores: [chosen], reason: "" } : undefined;
};

const ADAPTERS: Record<ClassificationAdapterShapeValue, AdapterSpec> = {
	[ClassificationAdapterShape.DecisionApi]: {
		path: "/v1/systemone",
		body: (model, labels, text) => ({
			model,
			state: text,
			questions: {
				[DECISION_QUESTION]: {
					type: "choice",
					instructions: DECISION_INSTRUCTION,
					criteria: Object.fromEntries(labels.map((label) => [label, label])),
				},
			},
		}),
		read: readDecision,
		confidenceKind: "Calibrated",
	},
	[ClassificationAdapterShape.ChatJsonSchema]: {
		path: "/chat/completions",
		body: (model, labels, text) => ({
			model,
			temperature: 0,
			messages: [
				{ role: "system", content: CHAT_INSTRUCTION },
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
							reason: { type: ["string", "null"] },
						},
						required: ["label", "confidence", "reason"],
						additionalProperties: false,
					},
				},
			},
		}),
		read: readChat,
		confidenceKind: "Advisory",
	},
	[ClassificationAdapterShape.JinaClassify]: {
		path: "/v1/classify",
		body: (model, labels, text) => ({ model, input: [{ text }], labels }),
		read: readJina,
		confidenceKind: "Advisory",
	},
};

const isTimeout = (error: unknown): boolean =>
	error instanceof DOMException && error.name === "TimeoutError";

const loggableUrl = (baseUrl: string): string => {
	const { origin, pathname } = new URL(baseUrl);
	return `${origin}${pathname}`;
};

const exchange = async <L extends string>(
	call: ClassifierCall<L>,
	timeoutMs: number,
): Promise<ClassifierResult<L>> => {
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
	const latencyMs = (): number => Math.round(performance.now() - started);
	const failed = (
		kind: ClassificationFailureKindValue,
		status?: number,
	): ClassifierResult<L> => ({
		ok: false,
		kind,
		...(status === undefined ? {} : { status }),
		latencyMs: latencyMs(),
	});

	return fetch(`${provider.baseUrl.replace(/\/+$/, "")}${adapter.path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(adapter.body(provider.model, labels, text)),
		signal: AbortSignal.timeout(timeoutMs),
	}).then(
		(response) => {
			if (!response.ok) {
				void response.body?.cancel();
				return failed(failureKindForStatus(response.status), response.status);
			}
			return response
				.json()
				.then((answer: unknown) => adapter.read(answer, labels))
				.then(
					(answer): ClassifierResult<L> => {
						const scores = (answer?.scores ?? []).flatMap((entry) => {
							const label = labels.find(
								(candidate) => candidate === entry.label,
							);
							return label === undefined
								? []
								: [{ label, confidence: entry.confidence }];
						});
						if (!answer || scores.length === 0) {
							return failed(ClassificationFailureKind.Unparseable);
						}
						return {
							ok: true,
							scores,
							reason: answer.reason,
							confidenceKind: adapter.confidenceKind,
							inputWords: countWords(text),
							latencyMs: latencyMs(),
						};
					},
					(error: unknown) =>
						failed(
							isTimeout(error)
								? ClassificationFailureKind.TimedOut
								: ClassificationFailureKind.Unparseable,
						),
				);
		},
		(error: unknown) =>
			failed(
				isTimeout(error)
					? ClassificationFailureKind.TimedOut
					: ClassificationFailureKind.Unreachable,
			),
	);
};

export const classifyWithProvider = async <
	L extends string = ClassificationLabelValue,
>(
	call: ClassifierCall<L>,
	deps: ClassifierDeps,
): Promise<ClassifierResult<L>> => {
	const result = await exchange(call, deps.timeoutMs ?? CLASSIFIER_TIMEOUT_MS);
	if (result.ok) return result;
	deps.logger.warn(
		{
			adapterShape: call.provider.adapterShape,
			baseUrl: loggableUrl(call.provider.baseUrl),
			model: call.provider.model,
			kind: result.kind,
			status: result.status,
			latencyMs: result.latencyMs,
		},
		"classification provider call failed",
	);
	return result;
};
