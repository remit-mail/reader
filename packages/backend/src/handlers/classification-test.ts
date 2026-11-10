import type {
	ClassificationTestFailed,
	ClassificationTestInput,
	ClassificationTestPassed,
} from "@remit/api-openapi-types";
import type { IAccountSettingRepository } from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import { AccountSettingName } from "@remit/domain-enums";
import {
	CLASSIFIER_FAILURE_HELP,
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
	type SerializedEncryptedPayload,
} from "@remit/secrets-service";
import {
	type ClassificationProviderSave,
	decideClassificationProvider,
	readStoredClassification,
} from "./classification-settings.js";
import type { UserSettingsOutcome } from "./user-settings.js";

export interface ClassificationTestDeps {
	accountSetting: Pick<IAccountSettingRepository, "get" | "getMany">;
	secrets: Pick<SecretsService, "decrypt">;
	logger: ClassifierLogger;
	timeoutMs?: number;
}

export type ClassificationTestOutcome =
	| { ok: true; value: ClassificationTestPassed | ClassificationTestFailed }
	| Extract<UserSettingsOutcome, { ok: false }>;

const PAYLOAD_FIELDS = ["encryptedDek", "encryptedData", "iv", "authTag"];

const isSerializedPayload = (
	stored: Record<string, string>,
): stored is Record<string, string> & SerializedEncryptedPayload =>
	PAYLOAD_FIELDS.every((field) => typeof stored[field] === "string");

const savedApiKey = async (
	deps: ClassificationTestDeps,
	accountConfigId: string,
): Promise<string> => {
	const row = await deps.accountSetting.get(
		accountConfigId,
		AccountSettingName.ClassificationApiKey,
	);
	if (!row) throw new Error("Saved classification API key disappeared");
	const stored = parseAccountSettingValue(
		AccountSettingName.ClassificationApiKey,
		row.value,
	).value;
	if (!isSerializedPayload(stored)) {
		throw new Error("Saved classification API key is not ciphertext");
	}
	return deps.secrets.decrypt(deserializeEncryptedPayload(stored));
};

const apiKeyOf = (
	deps: ClassificationTestDeps,
	accountConfigId: string,
	save: ClassificationProviderSave,
): Promise<string> => {
	if (save.apiKey.action === "Replace") {
		return Promise.resolve(save.apiKey.apiKey);
	}
	if (save.apiKey.action === "Keep") {
		return savedApiKey(deps, accountConfigId);
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
	const help = CLASSIFIER_FAILURE_HELP[result.kind];
	return {
		state: "Failed",
		latencyMs: result.latencyMs,
		...(result.status === undefined ? {} : { status: result.status }),
		kind: result.kind,
		field: help.field,
		fix: help.fix,
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
		await readStoredClassification(deps.accountSetting, accountConfigId),
	);
	if (!decided.ok) return decided;
	const save = decided.value;

	const result = await classifyWithProvider(
		{
			provider: {
				adapterShape: save.preset.adapterShape,
				baseUrl: save.baseUrl,
				model: save.model,
				apiKey: await apiKeyOf(deps, accountConfigId, save),
			},
			labels: CLASSIFIER_LABELS,
			message: CLASSIFIER_SAMPLE_MESSAGE,
		},
		{ logger: deps.logger, timeoutMs: deps.timeoutMs },
	);
	return { ok: true, value: answerOf(result) };
};
