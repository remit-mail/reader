import type {
	IAccountSettingRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import {
	CLASSIFICATION_PRESETS,
	type ClassificationApiKeyCiphertext,
	readSavedClassification,
} from "@remit/data-ports/classification-presets";
import {
	deserializeEncryptedPayload,
	type SecretsService,
} from "@remit/secrets-service";
import type { ParsedMail } from "mailparser";
import {
	type ClassificationLabelDeps,
	type ClassificationLabels,
	ensureClassificationLabels,
} from "../classification-labels.js";
import type {
	ClassifierLogger,
	ClassifierProvider,
} from "./classifier-adapter.js";
import type { ClassifierMessage } from "./classifier-request.js";

export interface ClassifierConfig {
	accountSetting: Pick<IAccountSettingRepository, "getMany">;
	secrets: Pick<SecretsService, "decrypt">;
	labelService: ClassificationLabelDeps;
	messageLabelService: Pick<IMessageLabelRepository, "apply">;
	logger: ClassifierLogger;
}

export type ClassifierGate =
	| { state: "Off" }
	| {
			state: "On";
			provider: ClassifierProvider;
			savedAt: number;
			labels: ClassificationLabels;
	  };

export const CLASSIFIER_OFF: ClassifierGate = { state: "Off" };

type KeyRead = { ok: true; apiKey: string } | { ok: false };

const readKey = (
	config: ClassifierConfig,
	ciphertext: ClassificationApiKeyCiphertext | undefined,
): Promise<KeyRead> => {
	if (!ciphertext) return Promise.resolve({ ok: true, apiKey: "" });
	return config.secrets.decrypt(deserializeEncryptedPayload(ciphertext)).then(
		(apiKey): KeyRead => ({ ok: true, apiKey }),
		(): KeyRead => ({ ok: false }),
	);
};

export const readClassifierGate = async (
	config: ClassifierConfig,
	accountConfigId: string,
): Promise<ClassifierGate> => {
	const saved = await readSavedClassification(
		config.accountSetting,
		accountConfigId,
	);
	if (saved.state === "UnknownPreset") {
		config.logger.warn(
			{ accountConfigId, presetId: saved.presetId },
			"Stored classification preset is unknown; using the built-in rules",
		);
		return CLASSIFIER_OFF;
	}
	if (saved.state === "NotConfigured" || !saved.enabled) return CLASSIFIER_OFF;
	const key = await readKey(config, saved.apiKeyCiphertext);
	if (!key.ok) {
		config.logger.warn(
			{ accountConfigId, presetId: saved.presetId },
			"Classification api key does not decrypt; using the built-in rules",
		);
		return CLASSIFIER_OFF;
	}
	return {
		state: "On",
		provider: {
			adapterShape: CLASSIFICATION_PRESETS[saved.presetId].adapterShape,
			baseUrl: saved.baseUrl,
			model: saved.model,
			apiKey: key.apiKey,
		},
		savedAt: saved.savedAt,
		labels: await ensureClassificationLabels(
			config.labelService,
			accountConfigId,
		),
	};
};

export const classifierMessageOf = (parsed: ParsedMail): ClassifierMessage => ({
	headers: parsed.headerLines.map(({ line }) => {
		const colon = line.indexOf(":");
		return {
			name: line.slice(0, colon),
			value: line.slice(colon + 1).trim(),
		};
	}),
	text: parsed.text ?? "",
});
