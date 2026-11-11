import type {
	ClassificationPresetId,
	ClassificationUnrunnableReason,
	ClassificationValueSource,
} from "@remit/api-openapi-types";
import {
	AccountSettingName,
	ClassificationUnrunnableReason as UnrunnableReason,
	ClassificationValueSource as ValueSource,
} from "@remit/domain-enums";
import {
	type AccountSettingValueFor,
	parseAccountSettingValue,
} from "./account-settings.js";
import {
	CLASSIFICATION_PRESETS,
	CLASSIFICATION_SETTING_NAMES,
	type ClassificationApiKeyCiphertext,
	type ClassificationDeploymentDefault,
	classificationUsageName,
	DEFAULT_CLASSIFICATION_DAILY_LIMIT,
	isClassificationPresetId,
	utcDateOf,
} from "./classification-presets.js";
import type { IAccountConfigRepository } from "./interfaces/account-config.js";
import type { IAccountSettingRepository } from "./interfaces/account-setting.js";
import type { AccountSettingItem } from "./types.js";
export type ClassificationSettingRow = Pick<
	AccountSettingItem,
	"name" | "value" | "updatedAt"
>;

export interface Sourced<
	T,
	S extends ClassificationValueSource = ClassificationValueSource,
> {
	value: T;
	source: S;
}

export type SavedClassificationApiKey = {
	ciphertext: ClassificationApiKeyCiphertext;
};

export type ResolvedClassificationApiKey<Saved = SavedClassificationApiKey> =
	| ({ source: "Saved" } & Saved)
	| { source: "Deployment"; apiKey: string }
	| { source: "Default" };

export interface ResolvedClassificationProvider<
	Saved = SavedClassificationApiKey,
> {
	state: "Configured";
	presetId: Sourced<ClassificationPresetId, "Saved" | "Deployment">;
	model: Sourced<string>;
	baseUrl: Sourced<string>;
	apiKey: ResolvedClassificationApiKey<Saved>;
	enabled: Sourced<boolean>;
	dailyLimit: Sourced<number>;
	classifiesAfter: number;
}

export type ResolvedClassification<Saved = SavedClassificationApiKey> =
	| { state: "NotConfigured" }
	| { state: "UnknownPreset"; presetId: string }
	| {
			state: "Unrunnable";
			presetId: ClassificationPresetId;
			reason: ClassificationUnrunnableReason;
	  }
	| ResolvedClassificationProvider<Saved>;

export interface ClassificationResolverInput {
	rows: readonly ClassificationSettingRow[];
	deployment: ClassificationDeploymentDefault;
	accountConfigCreatedAt: number;
}

type Configured = Extract<
	ClassificationDeploymentDefault,
	{ state: "Configured" }
>;

const settingOf = (
	rows: readonly ClassificationSettingRow[],
	name: string,
): ClassificationSettingRow | undefined =>
	rows.find((row) => row.name === name);

const savedValue = <N extends (typeof CLASSIFICATION_SETTING_NAMES)[number]>(
	rows: readonly ClassificationSettingRow[],
	name: N,
): AccountSettingValueFor<N>["value"] | undefined => {
	const row = settingOf(rows, name);
	return row ? parseAccountSettingValue(name, row.value).value : undefined;
};

const savedOrDeployed = <T>(
	saved: T | undefined,
	deployed: T | undefined,
): Sourced<T, "Saved" | "Deployment"> | undefined => {
	if (saved !== undefined) {
		return { value: saved, source: ValueSource.Saved };
	}
	if (deployed !== undefined) {
		return { value: deployed, source: ValueSource.Deployment };
	}
	return undefined;
};

const orDefault = <T>(found: Sourced<T> | undefined, fallback: T): Sourced<T> =>
	found ?? { value: fallback, source: ValueSource.Default };

const defaultBaseUrlOf = (
	defaultBaseUrl: string | undefined,
): Sourced<string> | undefined =>
	defaultBaseUrl === undefined
		? undefined
		: { value: defaultBaseUrl, source: ValueSource.Default };

const apiKeyOf = <Saved>(
	saved: Saved | undefined,
	deployed: Configured | undefined,
	presetId: ClassificationPresetId,
	baseUrl: string,
): ResolvedClassificationApiKey<Saved> => {
	if (saved !== undefined) {
		return { ...saved, source: ValueSource.Saved };
	}
	if (deployed?.presetId === presetId && deployed.baseUrl === baseUrl) {
		return {
			source: ValueSource.Deployment,
			apiKey: deployed.apiKey,
		};
	}
	return { source: ValueSource.Default };
};

export const savedClassificationApiKey = (
	rows: readonly ClassificationSettingRow[],
): SavedClassificationApiKey | undefined => {
	const ciphertext = savedValue(rows, AccountSettingName.ClassificationApiKey);
	return ciphertext === undefined ? undefined : { ciphertext };
};

export const resolveClassificationWith = <Saved>(
	{ rows, deployment, accountConfigCreatedAt }: ClassificationResolverInput,
	savedApiKey: Saved | undefined,
): ResolvedClassification<Saved> => {
	const deployed = deployment.state === "Configured" ? deployment : undefined;
	const presetRow = settingOf(rows, AccountSettingName.ClassificationPresetId);
	const savedPresetId = presetRow
		? parseAccountSettingValue(
				AccountSettingName.ClassificationPresetId,
				presetRow.value,
			).value
		: undefined;
	if (savedPresetId !== undefined && !isClassificationPresetId(savedPresetId)) {
		return { state: "UnknownPreset", presetId: savedPresetId };
	}
	const presetId = savedOrDeployed(savedPresetId, deployed?.presetId);
	if (presetId === undefined) return { state: "NotConfigured" };
	const preset = CLASSIFICATION_PRESETS[presetId.value];
	const matching = deployed?.presetId === presetId.value ? deployed : undefined;

	const baseUrl =
		savedOrDeployed(
			savedValue(rows, AccountSettingName.ClassificationBaseUrl),
			matching?.baseUrl,
		) ?? defaultBaseUrlOf(preset.defaultBaseUrl);
	if (baseUrl === undefined) {
		return {
			state: "Unrunnable",
			presetId: presetId.value,
			reason: UnrunnableReason.NoBaseUrl,
		};
	}
	const apiKey = apiKeyOf(savedApiKey, deployed, presetId.value, baseUrl.value);
	if (preset.needsKey && apiKey.source === ValueSource.Default) {
		return {
			state: "Unrunnable",
			presetId: presetId.value,
			reason: UnrunnableReason.NoApiKey,
		};
	}

	return {
		state: "Configured",
		presetId,
		model: orDefault(
			savedOrDeployed(
				savedValue(rows, AccountSettingName.ClassificationModel),
				matching?.model,
			),
			preset.defaultModel,
		),
		baseUrl,
		apiKey,
		enabled: orDefault(
			savedOrDeployed(
				savedValue(rows, AccountSettingName.ClassificationEnabled),
				deployed?.enabled,
			),
			false,
		),
		dailyLimit: orDefault(
			savedOrDeployed(
				savedValue(rows, AccountSettingName.ClassificationDailyLimit),
				deployed?.dailyLimit,
			),
			DEFAULT_CLASSIFICATION_DAILY_LIMIT,
		),
		classifiesAfter: presetRow ? presetRow.updatedAt : accountConfigCreatedAt,
	};
};

export const resolveClassification = (
	input: ClassificationResolverInput,
): ResolvedClassification =>
	resolveClassificationWith(input, savedClassificationApiKey(input.rows));

export interface ClassificationResolverDeps {
	accountSetting: Pick<IAccountSettingRepository, "getMany">;
	accountConfig: Pick<IAccountConfigRepository, "get">;
	classificationDefault: ClassificationDeploymentDefault;
}

export const readClassificationInput = async (
	deps: ClassificationResolverDeps,
	accountConfigId: string,
): Promise<ClassificationResolverInput> => {
	const [rows, accountConfig] = await Promise.all([
		deps.accountSetting.getMany(
			[accountConfigId],
			CLASSIFICATION_SETTING_NAMES,
		),
		deps.accountConfig.get(accountConfigId),
	]);
	return {
		rows,
		deployment: deps.classificationDefault,
		accountConfigCreatedAt: accountConfig.createdAt,
	};
};

export const readResolvedClassification = async (
	deps: ClassificationResolverDeps,
	accountConfigId: string,
): Promise<ResolvedClassification> =>
	resolveClassification(await readClassificationInput(deps, accountConfigId));

export const isClassificationBudgetSpent = async (
	deps: ClassificationResolverDeps,
	account: { accountId: string; accountConfigId: string },
	now: number,
): Promise<boolean> => {
	const resolved = await readResolvedClassification(
		deps,
		account.accountConfigId,
	);
	if (resolved.state !== "Configured" || !resolved.enabled.value) return false;
	const name = classificationUsageName(account.accountId);
	const [usage] = await deps.accountSetting.getMany(
		[account.accountConfigId],
		[name],
	);
	if (!usage) return false;
	const count = parseAccountSettingValue(
		AccountSettingName.ClassificationUsage,
		usage.value,
	).value;
	return (
		count.date === utcDateOf(now) && count.calls >= resolved.dailyLimit.value
	);
};
