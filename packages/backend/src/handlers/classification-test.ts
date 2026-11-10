import type {
	ClassificationFailureKind,
	ClassificationField,
	ClassificationTestFailed,
	ClassificationTestInput,
	ClassificationTestPassed,
} from "@remit/api-openapi-types";
import type { ClassificationResolverDeps } from "@remit/data-ports/classification-resolver";
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
	type ClassificationProviderSave,
	decideClassificationProvider,
	readKnownClassification,
} from "./classification-settings.js";
import type { UserSettingsOutcome } from "./user-settings.js";

export interface ClassificationTestDeps extends ClassificationResolverDeps {
	secrets: Pick<SecretsService, "decrypt">;
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
	save: ClassificationProviderSave,
): Promise<string> => {
	if (save.apiKey.action === "Replace") {
		return Promise.resolve(save.apiKey.apiKey);
	}
	if (save.apiKey.action === "Keep") {
		return deps.secrets.decrypt(
			deserializeEncryptedPayload(save.apiKey.ciphertext),
		);
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
	const decided = decideClassificationProvider(
		{
			classificationPresetId: input.presetId,
			classificationModel: input.model,
			classificationBaseUrl: input.baseUrl,
			classificationApiKey: input.apiKey,
		},
		await readKnownClassification(deps, accountConfigId),
	);
	if (!decided.ok) return decided;
	const save = decided.value;

	const result = await classifyWithProvider(
		{
			provider: {
				adapterShape: save.preset.adapterShape,
				baseUrl: save.baseUrl,
				model: save.model,
				apiKey: await apiKeyOf(deps, save),
			},
			labels: CLASSIFIER_LABELS,
			message: CLASSIFIER_SAMPLE_MESSAGE,
		},
		{ logger: deps.logger },
	);
	return { ok: true, value: answerOf(result) };
};
