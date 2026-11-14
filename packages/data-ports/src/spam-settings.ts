import {
	AccountSettingName,
	SpamJudgeName,
	SpamLabelPlacement,
} from "@remit/domain-enums";
import { parseAccountSettingValue } from "./account-settings.js";
import type { IAccountSettingRepository } from "./interfaces/account-setting.js";
import type { SpamJudgeConfig, SpamPipeline } from "./spam-pipeline.js";
import type {
	AccountSettingItem,
	SpamLabelPlacementValue,
	SpamSettingsItem,
} from "./types.js";

/** Each per-label placement field of `UpdateUserSettingsInput` and the setting it saves. */
export const SPAM_PLACEMENT_SETTINGS = [
	["spamPlacementSpam", AccountSettingName.SpamPlacementSpam],
	["spamPlacementPhishing", AccountSettingName.SpamPlacementPhishing],
] as const;

type SpamSettingName = (typeof SPAM_PLACEMENT_SETTINGS)[number][1];

export interface SpamSettingsDeps {
	accountSetting: Pick<IAccountSettingRepository, "getMany">;
	spamPipeline: SpamPipeline;
}

const placementOf = (
	rows: readonly Pick<AccountSettingItem, "name" | "value">[],
	name: SpamSettingName,
): SpamLabelPlacementValue => {
	const row = rows.find((candidate) => candidate.name === name);
	return row
		? parseAccountSettingValue(name, row.value).value
		: SpamLabelPlacement.MoveToSpam;
};

const resolveSpamSettings = (
	rows: readonly Pick<AccountSettingItem, "name" | "value">[],
	pipeline: SpamPipeline,
): SpamSettingsItem => ({
	thresholds: pipeline.find(
		(judge): judge is Extract<SpamJudgeConfig, { name: "Inline" }> =>
			judge.name === SpamJudgeName.Inline,
	)?.thresholds ?? { state: "Unset" },
	spamPlacement: placementOf(rows, AccountSettingName.SpamPlacementSpam),
	phishingPlacement: placementOf(
		rows,
		AccountSettingName.SpamPlacementPhishing,
	),
});

export const readResolvedSpamSettings = async (
	deps: SpamSettingsDeps,
	accountConfigId: string,
): Promise<SpamSettingsItem> =>
	resolveSpamSettings(
		await deps.accountSetting.getMany(
			[accountConfigId],
			SPAM_PLACEMENT_SETTINGS.map(([, name]) => name),
		),
		deps.spamPipeline,
	);
