import type {
	AccountSettingItem,
	IAccountSettingRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import {
	CLASSIFICATION_PRESETS,
	isClassificationPresetId,
} from "@remit/data-ports/classification-presets";
import { AccountSettingName } from "@remit/domain-enums";
import {
	deserializeEncryptedPayload,
	type SecretsService,
} from "@remit/secrets-service";
import type { ParsedMail } from "mailparser";
import type { ClassificationLabelDeps } from "../classification-labels.js";
import {
	type ClassifierCall,
	type ClassifierLogger,
	type ClassifierProvider,
	type ClassifierResult,
	classifyWithProvider,
} from "./classifier-adapter.js";
import type { ClassifierMessage } from "./classifier-request.js";

export interface ClassifierConfig {
	accountSetting: Pick<IAccountSettingRepository, "getMany">;
	secrets: Pick<SecretsService, "decrypt">;
	mailboxSpecialUseService: Pick<
		IMailboxSpecialUseRepository,
		"findInboxMailbox"
	>;
	mailboxService: Pick<IMailboxRepository, "get">;
	labelService: ClassificationLabelDeps;
	messageLabelService: Pick<IMessageLabelRepository, "apply">;
	logger: ClassifierLogger;
	timeoutMs?: number;
}

export type ClassifierGate =
	| { state: "Off" }
	| { state: "On"; provider: ClassifierProvider; savedAt: number };

const OFF: ClassifierGate = { state: "Off" };

const GATE_SETTING_NAMES = [
	AccountSettingName.ClassificationPresetId,
	AccountSettingName.ClassificationModel,
	AccountSettingName.ClassificationBaseUrl,
	AccountSettingName.ClassificationApiKey,
	AccountSettingName.ClassificationEnabled,
] as const;

const firstSyncFinished = async (
	config: ClassifierConfig,
	accountId: string,
): Promise<boolean> => {
	const inbox =
		await config.mailboxSpecialUseService.findInboxMailbox(accountId);
	if (!inbox) return false;
	const mailbox = await config.mailboxService.get(accountId, inbox.mailboxId);
	return (mailbox.initialSyncCompletedAt ?? 0) > 0;
};

export const readClassifierGate = async (
	config: ClassifierConfig,
	accountConfigId: string,
	accountId: string,
): Promise<ClassifierGate> => {
	const rows = await config.accountSetting.getMany(
		[accountConfigId],
		GATE_SETTING_NAMES,
	);
	const rowOf = (name: string): AccountSettingItem | undefined =>
		rows.find((row) => row.name === name);
	const presetRow = rowOf(AccountSettingName.ClassificationPresetId);
	const enabledRow = rowOf(AccountSettingName.ClassificationEnabled);
	if (!presetRow || !enabledRow) return OFF;
	const enabled = parseAccountSettingValue(
		AccountSettingName.ClassificationEnabled,
		enabledRow.value,
	).value;
	if (!enabled) return OFF;
	const presetId = parseAccountSettingValue(
		AccountSettingName.ClassificationPresetId,
		presetRow.value,
	).value;
	if (!isClassificationPresetId(presetId)) {
		throw new Error(`Stored classification preset is unknown: ${presetId}`);
	}
	if (!(await firstSyncFinished(config, accountId))) return OFF;

	const preset = CLASSIFICATION_PRESETS[presetId];
	const stringOf = (
		name:
			| typeof AccountSettingName.ClassificationModel
			| typeof AccountSettingName.ClassificationBaseUrl,
		fallback: string,
	): string => {
		const row = rowOf(name);
		const value = row ? parseAccountSettingValue(name, row.value).value : "";
		return value === "" ? fallback : value;
	};
	const keyRow = rowOf(AccountSettingName.ClassificationApiKey);
	const apiKey = keyRow
		? await config.secrets.decrypt(
				deserializeEncryptedPayload(
					parseAccountSettingValue(
						AccountSettingName.ClassificationApiKey,
						keyRow.value,
					).value,
				),
			)
		: "";
	return {
		state: "On",
		provider: {
			adapterShape: preset.adapterShape,
			baseUrl: stringOf(
				AccountSettingName.ClassificationBaseUrl,
				preset.defaultBaseUrl ?? "",
			),
			model: stringOf(
				AccountSettingName.ClassificationModel,
				preset.defaultModel,
			),
			apiKey,
		},
		savedAt: (keyRow ?? presetRow).updatedAt,
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

export const classifyArrival = (
	config: ClassifierConfig,
	call: ClassifierCall,
): Promise<ClassifierResult> =>
	classifyWithProvider(call, {
		logger: config.logger,
		...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
	});
