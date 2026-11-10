import type {
	ClassificationConfigured,
	ClassificationNotConfigured,
	ClassificationPreset,
	ClassificationPresetId,
	ClassificationUsage,
	UpdateUserSettingsInput,
} from "@remit/api-openapi-types";
import type { DailyCount, IAccountSettingRepository } from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import {
	CLASSIFICATION_PRESETS,
	CLASSIFICATION_SETTING_NAMES,
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import {
	type ClassificationResolverDeps,
	ClassificationSource,
	type ResolvedClassification,
	type ResolvedClassificationProvider,
	readResolvedClassification,
} from "@remit/data-ports/classification-resolver";
import { AccountSettingName } from "@remit/domain-enums";
import {
	type ClassificationLabelDeps,
	ensureClassificationLabels,
} from "@remit/mailbox-service";
import {
	type SecretsService,
	type SerializedEncryptedPayload,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { UserSettingsOutcome } from "./user-settings.js";

export type ClassificationSettingsDeps = {
	accountSetting: Pick<
		IAccountSettingRepository,
		"getMany" | "upsert" | "delete"
	>;
	secrets: Pick<SecretsService, "encrypt">;
	label: ClassificationLabelDeps;
};

type Refusal = Extract<UserSettingsOutcome, { ok: false }>;
type Decision<T> = { ok: true; value: T } | Refusal;

type ApiKeyChange =
	| { action: "Keep"; ciphertext: SerializedEncryptedPayload }
	| { action: "Replace"; apiKey: string }
	| { action: "Delete" };

export interface ClassificationProviderSave {
	preset: ClassificationPreset;
	model: string;
	baseUrl: string;
	apiKey: ApiKeyChange;
}

type ClassificationInput = Pick<
	UpdateUserSettingsInput,
	| "classificationPresetId"
	| "classificationModel"
	| "classificationBaseUrl"
	| "classificationApiKey"
	| "classificationEnabled"
	| "classificationDailyLimit"
>;

export type KnownClassification = Exclude<
	ResolvedClassification,
	{ state: "UnknownPreset" }
>;

export const readKnownClassification = async (
	deps: ClassificationResolverDeps,
	accountConfigId: string,
): Promise<KnownClassification> => {
	const resolved = await readResolvedClassification(deps, accountConfigId);
	if (resolved.state === "UnknownPreset") {
		throw new Error(
			`Stored classification preset is unknown: ${resolved.presetId}`,
		);
	}
	return resolved;
};

const refuse = (code: string, message: string): Refusal => ({
	ok: false,
	error: { code, message },
});

const isHttpUrl = (value: string): boolean => {
	if (!URL.canParse(value)) return false;
	const { protocol } = new URL(value);
	return protocol === "http:" || protocol === "https:";
};

const savesClassificationProvider = (input: ClassificationInput): boolean =>
	input.classificationPresetId !== undefined ||
	input.classificationModel !== undefined ||
	input.classificationBaseUrl !== undefined ||
	input.classificationApiKey !== undefined;

const baseUrlFor = (
	preset: ClassificationPreset,
	requested: string,
): Decision<string> => {
	if (requested === "") {
		if (preset.defaultBaseUrl === undefined) {
			return refuse(
				"InvalidClassificationBaseUrl",
				`classificationBaseUrl is required for ${preset.label}`,
			);
		}
		return { ok: true, value: preset.defaultBaseUrl };
	}
	if (!isHttpUrl(requested)) {
		return refuse(
			"InvalidClassificationBaseUrl",
			"classificationBaseUrl must be an http or https URL",
		);
	}
	return { ok: true, value: requested };
};

const apiKeyFor = (
	preset: ClassificationPreset,
	requested: string,
	keptKey: SerializedEncryptedPayload | undefined,
): Decision<ApiKeyChange> => {
	if (!preset.needsKey) return { ok: true, value: { action: "Delete" } };
	if (requested !== "") {
		return { ok: true, value: { action: "Replace", apiKey: requested } };
	}
	if (keptKey) {
		return { ok: true, value: { action: "Keep", ciphertext: keptKey } };
	}
	return refuse(
		"ClassificationApiKeyRequired",
		`classificationApiKey is required for ${preset.label}`,
	);
};

const presetIdOf = (
	known: KnownClassification,
): ClassificationPresetId | undefined => {
	if (known.state === "NotConfigured") return undefined;
	if (known.state === "Unrunnable") return known.presetId;
	return known.presetId.value;
};

export const decideClassificationProvider = (
	input: ClassificationInput,
	known: KnownClassification,
): Decision<ClassificationProviderSave> => {
	const presetId = input.classificationPresetId ?? presetIdOf(known);
	if (presetId === undefined) {
		return refuse(
			"ClassificationNotConfigured",
			"classificationPresetId is required: no classification provider is saved",
		);
	}
	const preset = CLASSIFICATION_PRESETS[presetId];
	const kept =
		known.state === "Configured" && known.presetId.value === presetId
			? known
			: undefined;

	const baseUrl = baseUrlFor(
		preset,
		(input.classificationBaseUrl ?? kept?.baseUrl.value ?? "").trim(),
	);
	if (!baseUrl.ok) return baseUrl;

	const apiKey = apiKeyFor(
		preset,
		(input.classificationApiKey ?? "").trim(),
		kept?.apiKey.source === ClassificationSource.Saved
			? kept.apiKey.ciphertext
			: undefined,
	);
	if (!apiKey.ok) return apiKey;

	const model = (input.classificationModel ?? kept?.model.value ?? "").trim();
	return {
		ok: true,
		value: {
			preset,
			model: model === "" ? preset.defaultModel : model,
			baseUrl: baseUrl.value,
			apiKey: apiKey.value,
		},
	};
};

export const publicClassification = (
	resolved: ResolvedClassificationProvider | { state: "NotConfigured" },
	usage: ClassificationUsage[],
): ClassificationNotConfigured | ClassificationConfigured => {
	if (resolved.state === "NotConfigured") return resolved;
	return {
		state: "Configured",
		presetId: resolved.presetId.value,
		model: resolved.model.value,
		baseUrl: resolved.baseUrl.value,
		apiKeySaved: resolved.apiKey.source === ClassificationSource.Saved,
		enabled: resolved.enabled.value,
		dailyLimit: resolved.dailyLimit.value,
		savedAt: resolved.classifiesAfter,
		usage,
	};
};

const CLASSIFICATION_INPUT_TOKENS_PER_CALL = 1_500;

const nextUtcMidnight = (epochMs: number): string => {
	const now = new Date(epochMs);
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
	).toISOString();
};

const callsOn = (usage: DailyCount | undefined, date: string): number =>
	usage?.date === date ? usage.calls : 0;

const classificationCost = (
	preset: ClassificationPreset,
	calls: number,
): ClassificationUsage["cost"] => {
	if (preset.price.state === "NoPrice") return { state: "NoPrice" };
	return {
		state: "Priced",
		currency: preset.price.currency,
		amount:
			(calls *
				CLASSIFICATION_INPUT_TOKENS_PER_CALL *
				preset.price.perMillionInputTokens) /
			1_000_000,
	};
};

export const readClassificationUsage = async (
	accountSetting: Pick<IAccountSettingRepository, "getMany">,
	accountConfigId: string,
	accountIds: readonly string[],
	saved: { presetId: ClassificationPresetId; dailyLimit: number },
	now: number,
): Promise<ClassificationUsage[]> => {
	const rows = await accountSetting.getMany(
		[accountConfigId],
		accountIds.map(classificationUsageName),
	);
	const today = utcDateOf(now);
	const resetsAt = nextUtcMidnight(now);
	const preset = CLASSIFICATION_PRESETS[saved.presetId];
	return accountIds.map((accountId) => {
		const row = rows.find(
			(candidate) => candidate.name === classificationUsageName(accountId),
		);
		const calls = callsOn(
			row
				? parseAccountSettingValue(
						AccountSettingName.ClassificationUsage,
						row.value,
					).value
				: undefined,
			today,
		);
		return {
			accountId,
			calls,
			dailyLimit: saved.dailyLimit,
			resetsAt,
			cost: classificationCost(preset, calls),
		};
	});
};

export const classificationPresetsResponse = (): ClassificationPreset[] =>
	Object.values(CLASSIFICATION_PRESETS);

interface ClassificationChange {
	provider: ClassificationProviderSave | undefined;
	enabled: boolean | undefined;
	dailyLimit: number | undefined;
}

export const decideClassificationChange = (
	input: ClassificationInput,
	known: KnownClassification,
): Decision<ClassificationChange> => {
	let provider: ClassificationProviderSave | undefined;
	if (savesClassificationProvider(input)) {
		const decided = decideClassificationProvider(input, known);
		if (!decided.ok) return decided;
		provider = decided.value;
	}
	const configured = provider !== undefined || known.state === "Configured";
	if (input.classificationEnabled === true && !configured) {
		return refuse(
			"ClassificationNotConfigured",
			"classificationEnabled needs a saved classification provider",
		);
	}
	if (input.classificationDailyLimit !== undefined && !configured) {
		return refuse(
			"ClassificationNotConfigured",
			"classificationDailyLimit needs a saved classification provider",
		);
	}
	return {
		ok: true,
		value: {
			provider,
			enabled: configured ? input.classificationEnabled : undefined,
			dailyLimit: input.classificationDailyLimit,
		},
	};
};

const writeProvider = async (
	deps: ClassificationSettingsDeps,
	accountConfigId: string,
	save: ClassificationProviderSave,
): Promise<void> => {
	const { accountSetting } = deps;
	if (save.apiKey.action === "Delete") {
		await accountSetting.delete(
			accountConfigId,
			AccountSettingName.ClassificationApiKey,
		);
	}
	if (save.apiKey.action === "Replace") {
		const ciphertext = serializeEncryptedPayload(
			await deps.secrets.encrypt(save.apiKey.apiKey),
		);
		await accountSetting.upsert({
			accountConfigId,
			name: AccountSettingName.ClassificationApiKey,
			value: { kind: "Map", value: { ...ciphertext } },
		});
	}
	await accountSetting.upsert({
		accountConfigId,
		name: AccountSettingName.ClassificationModel,
		value: { kind: "String", value: save.model },
	});
	await accountSetting.upsert({
		accountConfigId,
		name: AccountSettingName.ClassificationBaseUrl,
		value: { kind: "String", value: save.baseUrl },
	});
	await accountSetting.upsert({
		accountConfigId,
		name: AccountSettingName.ClassificationPresetId,
		value: { kind: "String", value: save.preset.presetId },
	});
};

export const writeClassificationChange = async (
	deps: ClassificationSettingsDeps,
	accountConfigId: string,
	change: ClassificationChange,
): Promise<void> => {
	if (change.provider) {
		await writeProvider(deps, accountConfigId, change.provider);
	}
	if (change.enabled !== undefined) {
		await deps.accountSetting.upsert({
			accountConfigId,
			name: AccountSettingName.ClassificationEnabled,
			value: { kind: "Boolean", value: change.enabled },
		});
	}
	if (change.enabled === true) {
		await ensureClassificationLabels(deps.label, accountConfigId);
	}
	if (change.dailyLimit !== undefined) {
		await deps.accountSetting.upsert({
			accountConfigId,
			name: AccountSettingName.ClassificationDailyLimit,
			value: { kind: "Number", value: change.dailyLimit },
		});
	}
};

export const clearClassification = async (
	accountSetting: Pick<IAccountSettingRepository, "delete">,
	accountConfigId: string,
): Promise<void> => {
	for (const name of CLASSIFICATION_SETTING_NAMES) {
		await accountSetting.delete(accountConfigId, name);
	}
};
