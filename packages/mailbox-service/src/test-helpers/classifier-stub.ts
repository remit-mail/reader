import { randomBytes } from "node:crypto";
import type { IAccountSettingRepository } from "@remit/data-ports";
import {
	AccountSettingName,
	ClassificationPresetId,
} from "@remit/domain-enums";
import {
	createSecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import { CLASSIFIER_LABELS } from "../classifier/index.js";
import type { StubReply } from "./stub-http-server.js";

const dataKey = randomBytes(32);

export const classifierSecrets = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

/** A provider reply giving each label its probability, the highest as the choice. */
export const classifierDecision = (
	scores: Array<[string, number]>,
): StubReply => {
	const probabilities = Object.fromEntries(
		CLASSIFIER_LABELS.map((label) => [label, 0]),
	);
	for (const [label, probability] of scores) probabilities[label] = probability;
	const [top] = [...scores].sort((a, b) => b[1] - a[1]);
	return {
		status: 200,
		body: JSON.stringify({
			model: "jev-test",
			answers: {
				label: {
					type: "choice",
					choice: top[0],
					confidence: top[1],
					probabilities,
				},
			},
		}),
	};
};

/** Save a Jev classification provider at `baseUrl`, keyed with {@link classifierSecrets}. */
export const saveClassifierProvider = async (
	accountSetting: Pick<IAccountSettingRepository, "upsert">,
	accountConfigId: string,
	baseUrl: string,
	enabled = true,
): Promise<void> => {
	const upsert = (
		name: string,
		value: Parameters<IAccountSettingRepository["upsert"]>[0]["value"],
	) => accountSetting.upsert({ accountConfigId, name, value });
	await upsert(AccountSettingName.ClassificationApiKey, {
		kind: "Map",
		value: {
			...serializeEncryptedPayload(
				await classifierSecrets.encrypt("sk-test-key"),
			),
		},
	});
	await upsert(AccountSettingName.ClassificationModel, {
		kind: "String",
		value: "jev-test",
	});
	await upsert(AccountSettingName.ClassificationBaseUrl, {
		kind: "String",
		value: baseUrl,
	});
	await upsert(AccountSettingName.ClassificationPresetId, {
		kind: "String",
		value: ClassificationPresetId.Jev,
	});
	await upsert(AccountSettingName.ClassificationEnabled, {
		kind: "Boolean",
		value: enabled,
	});
};
