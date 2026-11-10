import type {
	ClassificationFailureKind,
	ClassificationField,
	ClassificationTestFailed,
	ClassificationTestInput,
	ClassificationTestPassed,
} from "@remit/api-openapi-types";
import { CLASSIFICATION_PRESETS } from "@remit/data-ports/classification-presets";
import {
	type ClassificationResolverDeps,
	ClassificationSource,
	type ResolvedClassificationApiKey,
	readClassificationInput,
} from "@remit/data-ports/classification-resolver";
import {
	ClassificationFailureKind as FailureKind,
	ClassificationField as Field,
} from "@remit/domain-enums";
import {
	CLASSIFIER_LABELS,
	CLASSIFIER_SAMPLE_MESSAGE,
	type ClassifierLogger,
	type ClassifierResult,
	type ClassifierScore,
	classifyWithProvider,
} from "@remit/mailbox-service/classifier";
import {
	deserializeEncryptedPayload,
	type SecretsService,
} from "@remit/secrets-service";
import {
	decideClassificationChange,
	type EnteredApiKey,
} from "./classification-settings.js";
import type { UserSettingsOutcome } from "./user-settings.js";

export interface ClassificationTestDeps extends ClassificationResolverDeps {
	secrets: Pick<SecretsService, "encrypt" | "decrypt">;
	logger: ClassifierLogger;
}

export type ClassificationTestOutcome =
	| { ok: true; value: ClassificationTestPassed | ClassificationTestFailed }
	| Extract<UserSettingsOutcome, { ok: false }>;

type FailureHelp =
	| { field: ClassificationField; fix: string }
	| { fix: string };

const REACH_FIX = "Check the endpoint runs and the Remit server can reach it";
const DEFAULT_MODEL_FIX = "Use the preset's default model";

const FAILURE_HELP: Record<ClassificationFailureKind, FailureHelp> = {
	[FailureKind.Unauthorized]: {
		field: Field.ApiKey,
		fix: "Replace the key, save, test again",
	},
	[FailureKind.ModelNotFound]: {
		field: Field.Model,
		fix: "Check the model name, or empty it for the default",
	},
	[FailureKind.RateLimited]: {
		fix: "Raise the limit at the provider, or lower the daily limit",
	},
	[FailureKind.Rejected]: { field: Field.Model, fix: DEFAULT_MODEL_FIX },
	[FailureKind.ProviderError]: {
		fix: "The provider is failing; built-in rules cover until it recovers",
	},
	[FailureKind.Unreachable]: { field: Field.BaseUrl, fix: REACH_FIX },
	[FailureKind.TimedOut]: { field: Field.BaseUrl, fix: REACH_FIX },
	[FailureKind.Unparseable]: { field: Field.Model, fix: DEFAULT_MODEL_FIX },
};

const apiKeyOf = (
	deps: ClassificationTestDeps,
	entered: EnteredApiKey,
	apiKey: ResolvedClassificationApiKey,
): Promise<string> => {
	if (entered.state === "Entered") return Promise.resolve(entered.apiKey);
	if (apiKey.source === ClassificationSource.Saved) {
		return deps.secrets.decrypt(deserializeEncryptedPayload(apiKey.ciphertext));
	}
	if (apiKey.source === ClassificationSource.Deployment) {
		return Promise.resolve(apiKey.apiKey);
	}
	return Promise.resolve("");
};

const topScore = (scores: ClassifierScore[]): ClassifierScore =>
	scores.reduce((best, score) =>
		score.confidence > best.confidence ? score : best,
	);

const answerOf = (
	result: ClassifierResult,
): ClassificationTestPassed | ClassificationTestFailed => {
	if (result.ok) {
		const top = topScore(result.scores);
		return {
			state: "Passed",
			latencyMs: result.latencyMs,
			label: top.label,
			confidence: top.confidence,
		};
	}
	return {
		state: "Failed",
		latencyMs: result.latencyMs,
		...(result.status === undefined ? {} : { status: result.status }),
		kind: result.kind,
		...FAILURE_HELP[result.kind],
	};
};

export const testClassificationProvider = async (
	deps: ClassificationTestDeps,
	accountConfigId: string,
	input: ClassificationTestInput,
): Promise<ClassificationTestOutcome> => {
	const decided = await decideClassificationChange(
		deps.secrets,
		await readClassificationInput(deps, accountConfigId),
		{
			classificationPresetId: input.presetId,
			classificationModel: input.model,
			classificationBaseUrl: input.baseUrl,
			classificationApiKey: input.apiKey,
		},
	);
	if (!decided.ok) return decided;
	const { resolved, enteredApiKey } = decided.value;
	if (resolved.state !== "Configured") {
		throw new Error(
			`A tested classification form resolved to ${resolved.state}`,
		);
	}

	const result = await classifyWithProvider(
		{
			provider: {
				adapterShape:
					CLASSIFICATION_PRESETS[resolved.presetId.value].adapterShape,
				baseUrl: resolved.baseUrl.value,
				model: resolved.model.value,
				apiKey: await apiKeyOf(deps, enteredApiKey, resolved.apiKey),
			},
			labels: CLASSIFIER_LABELS,
			message: CLASSIFIER_SAMPLE_MESSAGE,
		},
		{ logger: deps.logger },
	);
	return { ok: true, value: answerOf(result) };
};
