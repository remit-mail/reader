import type {
	ClassificationTestInput,
	UpdateUserSettingsInput,
	UserSettingsResponse,
} from "@remit/api-openapi-types";
import {
	invitationSenderInEffect,
	sendingAccountFor,
} from "@remit/calendar-service";
import {
	type IAccountConfigRepository,
	type IAccountRepository,
	type IAccountSettingRepository,
	readResolvedSpamSettings,
	SPAM_PLACEMENT_SETTINGS,
	type SpamPipeline,
} from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import type { ClassificationDeploymentDefault } from "@remit/data-ports/classification-presets";
import { readClassificationInput } from "@remit/data-ports/classification-resolver";
import { AccountSettingName } from "@remit/domain-enums";
import { logger } from "@remit/logger";
import type { ClassificationLabelDeps } from "@remit/mailbox-service";
import type { SecretsService } from "@remit/secrets-service";
import {
	classificationPresetsResponse,
	clearClassification,
	decideClassificationChange,
	publicClassification,
	readClassificationUsage,
	readKnownClassification,
	writeClassificationChange,
} from "../handlers/classification-settings.js";
import { testClassificationProvider } from "../handlers/classification-test.js";
import type { RemitClient } from "./data-client.js";

export interface UserSettingsDeps {
	accountSetting: Pick<
		IAccountSettingRepository,
		"get" | "getMany" | "upsert" | "delete"
	>;
	accountConfig: Pick<IAccountConfigRepository, "get">;
	getClassificationDefault: () => Promise<ClassificationDeploymentDefault>;
	spamPipeline: SpamPipeline;
	accounts: Pick<IAccountRepository, "listAllByAccountConfig">;
	secrets: Pick<SecretsService, "encrypt">;
	label: ClassificationLabelDeps;
}

/** The account the reader chose to send invitations from, if they chose one. */
export const chosenInvitationSender = async (
	accountSetting: Pick<IAccountSettingRepository, "get">,
	accountConfigId: string,
): Promise<string | undefined> => {
	const stored = await accountSetting.get(
		accountConfigId,
		AccountSettingName.DefaultInvitationSenderAccountId,
	);
	return stored
		? parseAccountSettingValue(
				AccountSettingName.DefaultInvitationSenderAccountId,
				stored.value,
			).value
		: undefined;
};

export const readUserSettings = async (
	deps: UserSettingsDeps,
	accountConfigId: string,
): Promise<UserSettingsResponse> => {
	const chosen = await chosenInvitationSender(
		deps.accountSetting,
		accountConfigId,
	);
	const accounts = await deps.accounts.listAllByAccountConfig(accountConfigId);
	const inEffect = invitationSenderInEffect(accounts, chosen);
	const resolved = await readKnownClassification(deps, accountConfigId);
	const usage =
		resolved.state === "Configured"
			? await readClassificationUsage(
					deps.accountSetting,
					accountConfigId,
					accounts.map((account) => account.accountId),
					{
						presetId: resolved.presetId.value,
						dailyLimit: resolved.dailyLimit.value,
					},
					Date.now(),
				)
			: [];
	return {
		...(inEffect && { defaultInvitationSenderAccountId: inEffect.accountId }),
		defaultInvitationSenderChosen:
			inEffect !== undefined && inEffect.accountId === chosen,
		classificationPresets: classificationPresetsResponse(),
		classification: publicClassification(resolved, usage),
		spam: await readResolvedSpamSettings(deps, accountConfigId),
	};
};

export type UserSettingsOutcome =
	| { ok: true; value: UserSettingsResponse }
	| { ok: false; error: { code: string; message: string } };

export const updateUserSettingsFor = async (
	deps: UserSettingsDeps,
	accountConfigId: string,
	input: UpdateUserSettingsInput,
): Promise<UserSettingsOutcome> => {
	const classification = decideClassificationChange(
		await readClassificationInput(deps, accountConfigId),
		input,
	);
	if (!classification.ok) return classification;
	const sender = input.defaultInvitationSenderAccountId;
	if (sender !== undefined) {
		const account = sendingAccountFor(
			await deps.accounts.listAllByAccountConfig(accountConfigId),
			sender,
		);
		if (!account.ok) {
			return {
				ok: false,
				error: { code: "UnknownSender", message: account.error.message },
			};
		}
	}
	await writeClassificationChange(deps, accountConfigId, classification.value);
	for (const [field, name] of SPAM_PLACEMENT_SETTINGS) {
		const value = input[field];
		if (value === undefined) continue;
		await deps.accountSetting.upsert({
			accountConfigId,
			name,
			value: { kind: "String", value },
		});
	}
	if (sender !== undefined) {
		await deps.accountSetting.upsert({
			accountConfigId,
			name: AccountSettingName.DefaultInvitationSenderAccountId,
			value: { kind: "String", value: sender },
		});
	}
	return { ok: true, value: await readUserSettings(deps, accountConfigId) };
};

export const userSettingsDepsOf = (
	client: RemitClient<never>,
): UserSettingsDeps => ({
	accountSetting: client.accountSetting,
	accountConfig: client.accountConfig,
	getClassificationDefault: client.getClassificationDefault,
	spamPipeline: client.spam.spamPipeline,
	accounts: client.account,
	secrets: client.secrets,
	label: client.label,
});

export const clearClassificationProviderFor = async (
	deps: UserSettingsDeps,
	accountConfigId: string,
): Promise<UserSettingsResponse> => {
	await clearClassification(deps.accountSetting, accountConfigId);
	return readUserSettings(deps, accountConfigId);
};

export const testClassificationProviderFor = (
	client: RemitClient<never>,
	accountConfigId: string,
	input: ClassificationTestInput,
) =>
	testClassificationProvider(
		{
			accountSetting: client.accountSetting,
			accountConfig: client.accountConfig,
			getClassificationDefault: client.getClassificationDefault,
			secrets: client.secrets,
			logger,
		},
		accountConfigId,
		input,
	);
