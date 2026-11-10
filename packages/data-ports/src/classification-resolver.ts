import type { ClassificationPresetId } from "@remit/api-openapi-types";
import { AccountSettingName } from "@remit/domain-enums";
import {
	type AccountSettingValueFor,
	parseAccountSettingValue,
} from "./account-settings.js";
import {
	CLASSIFICATION_PRESETS,
	CLASSIFICATION_SETTING_NAMES,
	type ClassificationApiKeyCiphertext,
	type ClassificationDeploymentDefault,
	DEFAULT_CLASSIFICATION_DAILY_LIMIT,
	isClassificationPresetId,
} from "./classification-presets.js";
import type { IAccountConfigRepository } from "./interfaces/account-config.js";
import type { IAccountSettingRepository } from "./interfaces/account-setting.js";
import type { AccountSettingItem } from "./types.js";

export const ClassificationSource = {
	Saved: "Saved",
	Deployment: "Deployment",
	Default: "Default",
} as const;

export type ClassificationSource =
	(typeof ClassificationSource)[keyof typeof ClassificationSource];

export interface Sourced<
	T,
	S extends ClassificationSource = ClassificationSource,
> {
	value: T;
	source: S;
}

export type ResolvedClassificationApiKey =
	| { source: "Saved"; ciphertext: ClassificationApiKeyCiphertext }
	| { source: "Deployment"; apiKey: string }
	| { source: "Default" };

export interface ResolvedClassificationProvider {
	state: "Configured";
	presetId: Sourced<ClassificationPresetId, "Saved" | "Deployment">;
	model: Sourced<string>;
	baseUrl: Sourced<string>;
	apiKey: ResolvedClassificationApiKey;
	enabled: Sourced<boolean>;
	dailyLimit: Sourced<number>;
	classifiesAfter: number;
}

export type UnrunnableReason = "NoBaseUrl" | "NoApiKey";

export type ResolvedClassification =
	| { state: "NotConfigured" }
	| { state: "UnknownPreset"; presetId: string }
	| {
			state: "Unrunnable";
			presetId: ClassificationPresetId;
			reason: UnrunnableReason;
	  }
	| ResolvedClassificationProvider;

export interface ClassificationResolverInput {
	rows: readonly AccountSettingItem[];
	deployment: ClassificationDeploymentDefault;
	accountConfigCreatedAt: number;
}

type Configured = Extract<
	ClassificationDeploymentDefault,
	{ state: "Configured" }
>;

const settingOf = (
	rows: readonly AccountSettingItem[],
	name: string,
): AccountSettingItem | undefined => rows.find((row) => row.name === name);

const savedValue = <N extends (typeof CLASSIFICATION_SETTING_NAMES)[number]>(
	rows: readonly AccountSettingItem[],
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
		return { value: saved, source: ClassificationSource.Saved };
	}
	if (deployed !== undefined) {
		return { value: deployed, source: ClassificationSource.Deployment };
	}
	return undefined;
};

const orDefault = <T>(found: Sourced<T> | undefined, fallback: T): Sourced<T> =>
	found ?? { value: fallback, source: ClassificationSource.Default };

const defaultBaseUrlOf = (
	defaultBaseUrl: string | undefined,
): Sourced<string> | undefined =>
	defaultBaseUrl === undefined
		? undefined
		: { value: defaultBaseUrl, source: ClassificationSource.Default };

const apiKeyOf = (
	rows: readonly AccountSettingItem[],
	deployed: Configured | undefined,
	presetId: ClassificationPresetId,
	baseUrl: string,
): ResolvedClassificationApiKey => {
	const ciphertext = savedValue(rows, AccountSettingName.ClassificationApiKey);
	if (ciphertext !== undefined) {
		return { source: ClassificationSource.Saved, ciphertext };
	}
	if (deployed?.presetId === presetId && deployed.baseUrl === baseUrl) {
		return { source: ClassificationSource.Deployment, apiKey: deployed.apiKey };
	}
	return { source: ClassificationSource.Default };
};

export const resolveClassification = ({
	rows,
	deployment,
	accountConfigCreatedAt,
}: ClassificationResolverInput): ResolvedClassification => {
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
			reason: "NoBaseUrl",
		};
	}
	const apiKey = apiKeyOf(rows, deployed, presetId.value, baseUrl.value);
	if (preset.needsKey && apiKey.source === ClassificationSource.Default) {
		return {
			state: "Unrunnable",
			presetId: presetId.value,
			reason: "NoApiKey",
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

export interface ClassificationResolverDeps {
	accountSetting: Pick<IAccountSettingRepository, "getMany">;
	accountConfig: Pick<IAccountConfigRepository, "get">;
	classificationDefault: ClassificationDeploymentDefault;
}

export const readResolvedClassification = async (
	deps: ClassificationResolverDeps,
	accountConfigId: string,
): Promise<ResolvedClassification> => {
	const [rows, accountConfig] = await Promise.all([
		deps.accountSetting.getMany(
			[accountConfigId],
			CLASSIFICATION_SETTING_NAMES,
		),
		deps.accountConfig.get(accountConfigId),
	]);
	return resolveClassification({
		rows,
		deployment: deps.classificationDefault,
		accountConfigCreatedAt: accountConfig.createdAt,
	});
};
