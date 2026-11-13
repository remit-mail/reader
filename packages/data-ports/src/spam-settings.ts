import { AccountSettingName, SpamLabelPlacement } from "@remit/domain-enums";
import { parseAccountSettingValue } from "./account-settings.js";
import type { IAccountSettingRepository } from "./interfaces/account-setting.js";
import type { SpamDeployment } from "./interfaces/spam.js";
import type {
	AccountSettingItem,
	SpamLabelPlacementValue,
	SpamSettingsItem,
} from "./types.js";

export const SPAM_SETTING_NAMES = [
	AccountSettingName.SpamPlacementSpam,
	AccountSettingName.SpamPlacementPhishing,
] as const;

type SpamSettingName = (typeof SPAM_SETTING_NAMES)[number];

export interface SpamSettingsDeps {
	accountSetting: Pick<IAccountSettingRepository, "getMany">;
	spamDeployment: SpamDeployment;
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

/**
 * Thresholds come from the deployment. A saved per-user threshold would
 * override them here, as `readResolvedClassification` lets a saved row
 * override a deployment value.
 */
export const resolveSpamSettings = (
	rows: readonly Pick<AccountSettingItem, "name" | "value">[],
	deployment: SpamDeployment,
): SpamSettingsItem => ({
	thresholds: deployment.thresholds,
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
		await deps.accountSetting.getMany([accountConfigId], SPAM_SETTING_NAMES),
		deps.spamDeployment,
	);
