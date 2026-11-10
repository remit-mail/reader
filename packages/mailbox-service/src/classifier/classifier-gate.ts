import type {
	IAccountConfigRepository,
	IAccountSettingRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import {
	CLASSIFICATION_PRESETS,
	type ClassificationDeploymentDefault,
} from "@remit/data-ports/classification-presets";
import {
	type ResolvedClassificationApiKey,
	readResolvedClassification,
} from "@remit/data-ports/classification-resolver";
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
	accountSetting: Pick<
		IAccountSettingRepository,
		"getMany" | "claimDailyCount"
	>;
	accountConfig: Pick<IAccountConfigRepository, "get">;
	classificationDefault: ClassificationDeploymentDefault;
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
			classifiesAfter: number;
			dailyLimit: number;
			labels: ClassificationLabels;
	  };

export const CLASSIFIER_OFF: ClassifierGate = { state: "Off" };

type KeyRead = { ok: true; apiKey: string } | { ok: false };

const readKey = (
	config: ClassifierConfig,
	apiKey: ResolvedClassificationApiKey,
): Promise<KeyRead> => {
	if (apiKey.source === "Default") {
		return Promise.resolve({ ok: true, apiKey: "" });
	}
	if (apiKey.source === "Deployment") {
		return Promise.resolve({ ok: true, apiKey: apiKey.apiKey });
	}
	const ciphertext = deserializeEncryptedPayload(apiKey.ciphertext);
	return config.secrets.decrypt(ciphertext).then(
		(apiKey): KeyRead => ({ ok: true, apiKey }),
		(): KeyRead => ({ ok: false }),
	);
};

export const readClassifierGate = async (
	config: ClassifierConfig,
	accountConfigId: string,
): Promise<ClassifierGate> => {
	const resolved = await readResolvedClassification(config, accountConfigId);
	if (resolved.state === "UnknownPreset") {
		config.logger.warn(
			{ accountConfigId, presetId: resolved.presetId },
			"Stored classification preset is unknown; using the built-in rules",
		);
		return CLASSIFIER_OFF;
	}
	if (resolved.state === "Unrunnable") {
		config.logger.warn(
			{ accountConfigId, presetId: resolved.presetId, reason: resolved.reason },
			"Classification provider cannot run; using the built-in rules",
		);
		return CLASSIFIER_OFF;
	}
	if (resolved.state === "NotConfigured" || !resolved.enabled.value) {
		return CLASSIFIER_OFF;
	}
	const presetId = resolved.presetId.value;
	const key = await readKey(config, resolved.apiKey);
	if (!key.ok) {
		config.logger.warn(
			{ accountConfigId, presetId },
			"Classification api key does not decrypt; using the built-in rules",
		);
		return CLASSIFIER_OFF;
	}
	return {
		state: "On",
		provider: {
			adapterShape: CLASSIFICATION_PRESETS[presetId].adapterShape,
			baseUrl: resolved.baseUrl.value,
			model: resolved.model.value,
			apiKey: key.apiKey,
		},
		classifiesAfter: resolved.classifiesAfter,
		dailyLimit: resolved.dailyLimit.value,
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
