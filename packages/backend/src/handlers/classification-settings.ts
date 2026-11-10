import type {
	ClassificationConfigured,
	ClassificationNotConfigured,
	ClassificationPreset,
	ClassificationPresetId,
	ClassificationUnrunnable,
	ClassificationUsage,
	UpdateUserSettingsInput,
} from "@remit/api-openapi-types";
import type {
	DailyCount,
	IAccountSettingRepository,
	UpsertAccountSettingInput,
} from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import {
	CLASSIFICATION_PRESETS,
	CLASSIFICATION_SETTING_NAMES,
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import {
	type ClassificationResolverDeps,
	type ClassificationResolverInput,
	type ClassificationSettingRow,
	type ResolvedClassification,
	readResolvedClassification,
	resolveClassification,
	resolveClassificationWith,
	type SavedClassificationApiKey,
	savedClassificationApiKey,
} from "@remit/data-ports/classification-resolver";
import {
	AccountSettingName,
	ClassificationValueSource as ValueSource,
} from "@remit/domain-enums";
import {
	type ClassificationLabelDeps,
	ensureClassificationLabels,
} from "@remit/mailbox-service";
import {
	type SecretsService,
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

type ClassificationSettingName = (typeof CLASSIFICATION_SETTING_NAMES)[number];

type SettingWrite =
	| {
			action: "Upsert";
			name: ClassificationSettingName;
			value: UpsertAccountSettingInput["value"];
	  }
	| { action: "Delete"; name: ClassificationSettingName };

type PlannedWrite = SettingWrite | { action: "Encrypt"; apiKey: string };

export type PlannedApiKey = Partial<SavedClassificationApiKey>;

export interface ClassificationChange {
	writes: PlannedWrite[];
	resolved: KnownClassification<PlannedApiKey>;
	ensuresLabels: boolean;
}

export type ClassificationInput = Pick<
	UpdateUserSettingsInput,
	| "classificationPresetId"
	| "classificationModel"
	| "classificationBaseUrl"
	| "classificationApiKey"
	| "classificationEnabled"
	| "classificationDailyLimit"
>;

export type KnownClassification<Saved = SavedClassificationApiKey> = Exclude<
	ResolvedClassification<Saved>,
	{ state: "UnknownPreset" }
>;

const knownOf = <Saved>(
	resolved: ResolvedClassification<Saved>,
): KnownClassification<Saved> => {
	if (resolved.state === "UnknownPreset") {
		throw new Error(
			`Stored classification preset is unknown: ${resolved.presetId}`,
		);
	}
	return resolved;
};

export const readKnownClassification = async (
	deps: ClassificationResolverDeps,
	accountConfigId: string,
): Promise<KnownClassification> =>
	knownOf(await readResolvedClassification(deps, accountConfigId));

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

const presetIdOf = <Saved>(
	known: KnownClassification<Saved>,
): ClassificationPresetId | undefined => {
	if (known.state === "NotConfigured") return undefined;
	if (known.state === "Unrunnable") return known.presetId;
	return known.presetId.value;
};

const textWrite = (
	name: ClassificationSettingName,
	requested: string | undefined,
	switched: boolean,
): SettingWrite[] => {
	const value = requested?.trim();
	if (value === undefined) return switched ? [{ action: "Delete", name }] : [];
	if (value === "") return [{ action: "Delete", name }];
	return [{ action: "Upsert", name, value: { kind: "String", value } }];
};

const apiKeyWrite = (
	preset: ClassificationPreset,
	requested: string,
	switched: boolean,
): PlannedWrite[] => {
	const name = AccountSettingName.ClassificationApiKey;
	if (!preset.needsKey) return [{ action: "Delete", name }];
	if (requested !== "") return [{ action: "Encrypt", apiKey: requested }];
	return switched ? [{ action: "Delete", name }] : [];
};

const planProviderWrites = (
	input: ClassificationInput,
	known: KnownClassification,
): Decision<PlannedWrite[]> => {
	const current = presetIdOf(known);
	const presetId = input.classificationPresetId ?? current;
	if (presetId === undefined) {
		return refuse(
			"ClassificationNotConfigured",
			"classificationPresetId is required: no classification provider is saved or inherited",
		);
	}
	const baseUrl = input.classificationBaseUrl?.trim();
	if (baseUrl !== undefined && baseUrl !== "" && !isHttpUrl(baseUrl)) {
		return refuse(
			"InvalidClassificationBaseUrl",
			"classificationBaseUrl must be an http or https URL",
		);
	}
	const switched = presetId !== current;
	return {
		ok: true,
		value: [
			...apiKeyWrite(
				CLASSIFICATION_PRESETS[presetId],
				(input.classificationApiKey ?? "").trim(),
				switched,
			),
			...textWrite(
				AccountSettingName.ClassificationModel,
				input.classificationModel,
				switched,
			),
			...textWrite(AccountSettingName.ClassificationBaseUrl, baseUrl, switched),
			{
				action: "Upsert",
				name: AccountSettingName.ClassificationPresetId,
				value: { kind: "String", value: presetId },
			},
		],
	};
};

const planWrites = (
	input: ClassificationInput,
	known: KnownClassification,
): Decision<PlannedWrite[]> => {
	const provider = savesClassificationProvider(input)
		? planProviderWrites(input, known)
		: { ok: true as const, value: [] };
	if (!provider.ok) return provider;
	const writes: PlannedWrite[] = [...provider.value];
	if (input.classificationEnabled !== undefined) {
		writes.push({
			action: "Upsert",
			name: AccountSettingName.ClassificationEnabled,
			value: { kind: "Boolean", value: input.classificationEnabled },
		});
	}
	if (input.classificationDailyLimit !== undefined) {
		writes.push({
			action: "Upsert",
			name: AccountSettingName.ClassificationDailyLimit,
			value: { kind: "Number", value: input.classificationDailyLimit },
		});
	}
	return { ok: true, value: writes };
};

const sealWrite = async (
	secrets: Pick<SecretsService, "encrypt">,
	write: PlannedWrite,
): Promise<SettingWrite> => {
	if (write.action !== "Encrypt") return write;
	const ciphertext = serializeEncryptedPayload(
		await secrets.encrypt(write.apiKey),
	);
	return {
		action: "Upsert",
		name: AccountSettingName.ClassificationApiKey,
		value: { kind: "Map", value: { ...ciphertext } },
	};
};

const applyWrites = (
	rows: readonly ClassificationSettingRow[],
	writes: readonly PlannedWrite[],
	now: number,
): ClassificationSettingRow[] =>
	writes.reduce<ClassificationSettingRow[]>((applied, write) => {
		if (write.action === "Encrypt") return applied;
		const kept = applied.filter((row) => row.name !== write.name);
		if (write.action === "Delete") return kept;
		return [...kept, { name: write.name, value: write.value, updatedAt: now }];
	}, Array.from(rows));

const plannedApiKeyOf = (
	rows: readonly ClassificationSettingRow[],
	writes: readonly PlannedWrite[],
): PlannedApiKey | undefined =>
	writes.some((write) => write.action === "Encrypt")
		? {}
		: savedClassificationApiKey(rows);

const refuseUnrunnable = (
	resolved: Extract<
		KnownClassification<PlannedApiKey>,
		{ state: "Unrunnable" }
	>,
): Refusal => {
	const { label } = CLASSIFICATION_PRESETS[resolved.presetId];
	if (resolved.reason === "NoBaseUrl") {
		return refuse(
			"InvalidClassificationBaseUrl",
			`classificationBaseUrl is required for ${label}`,
		);
	}
	return refuse(
		"ClassificationApiKeyRequired",
		`classificationApiKey is required for ${label}: no key is saved, and the deployment's key only applies to its own preset and base URL`,
	);
};

export const decideClassificationChange = (
	current: ClassificationResolverInput,
	input: ClassificationInput,
): Decision<ClassificationChange> => {
	const planned = planWrites(input, knownOf(resolveClassification(current)));
	if (!planned.ok) return planned;
	const writes = planned.value;
	const rows = applyWrites(current.rows, writes, Date.now());
	const resolved = knownOf(
		resolveClassificationWith(
			{ ...current, rows },
			plannedApiKeyOf(rows, writes),
		),
	);
	if (resolved.state === "NotConfigured") {
		if (input.classificationEnabled === true) {
			return refuse(
				"ClassificationNotConfigured",
				"classificationEnabled needs a saved or inherited classification provider",
			);
		}
		if (input.classificationDailyLimit !== undefined) {
			return refuse(
				"ClassificationNotConfigured",
				"classificationDailyLimit needs a saved or inherited classification provider",
			);
		}
		return {
			ok: true,
			value: {
				writes: [],
				resolved,
				ensuresLabels: false,
			},
		};
	}
	if (
		resolved.state === "Unrunnable" &&
		(savesClassificationProvider(input) || input.classificationEnabled === true)
	) {
		return refuseUnrunnable(resolved);
	}
	return {
		ok: true,
		value: {
			writes,
			resolved,
			ensuresLabels: input.classificationEnabled === true,
		},
	};
};

export const publicClassification = <Saved>(
	resolved: KnownClassification<Saved>,
	usage: ClassificationUsage[],
):
	| ClassificationNotConfigured
	| ClassificationUnrunnable
	| ClassificationConfigured => {
	if (resolved.state === "NotConfigured") return resolved;
	if (resolved.state === "Unrunnable") {
		return {
			state: "Unrunnable",
			presetId: resolved.presetId,
			reason: resolved.reason,
		};
	}
	return {
		state: "Configured",
		presetId: resolved.presetId.value,
		model: resolved.model.value,
		baseUrl: resolved.baseUrl.value,
		apiKeySaved: resolved.apiKey.source !== ValueSource.Default,
		enabled: resolved.enabled.value,
		dailyLimit: resolved.dailyLimit.value,
		sources: {
			presetId: resolved.presetId.source,
			model: resolved.model.source,
			baseUrl: resolved.baseUrl.source,
			apiKey: resolved.apiKey.source,
			enabled: resolved.enabled.source,
			dailyLimit: resolved.dailyLimit.source,
		},
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

export const writeClassificationChange = async (
	deps: ClassificationSettingsDeps,
	accountConfigId: string,
	change: ClassificationChange,
): Promise<void> => {
	for (const planned of change.writes) {
		const write = await sealWrite(deps.secrets, planned);
		if (write.action === "Delete") {
			await deps.accountSetting.delete(accountConfigId, write.name);
		} else {
			await deps.accountSetting.upsert({
				accountConfigId,
				name: write.name,
				value: write.value,
			});
		}
	}
	if (change.ensuresLabels) {
		await ensureClassificationLabels(deps.label, accountConfigId);
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
