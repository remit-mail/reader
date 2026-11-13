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
	type SpamDeployment,
} from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import type { ClassificationDeploymentDefault } from "@remit/data-ports/classification-presets";
import { readClassificationInput } from "@remit/data-ports/classification-resolver";
import { AccountSettingName } from "@remit/domain-enums";
import { logger } from "@remit/logger";
import type { ClassificationLabelDeps } from "@remit/mailbox-service";
import type { SecretsService } from "@remit/secrets-service";
import type {
	HandlerContext,
	OperationHandler,
	UserSettingsOperationIds,
} from "../types.js";
import { badRequest } from "./calendar.js";
import {
	classificationPresetsResponse,
	clearClassification,
	decideClassificationChange,
	publicClassification,
	readClassificationUsage,
	readKnownClassification,
	writeClassificationChange,
} from "./classification-settings.js";
import { testClassificationProvider } from "./classification-test.js";

export interface UserSettingsDeps {
	accountSetting: Pick<
		IAccountSettingRepository,
		"get" | "getMany" | "upsert" | "delete"
	>;
	accountConfig: Pick<IAccountConfigRepository, "get">;
	classificationDefault: ClassificationDeploymentDefault;
	spamDeployment: SpamDeployment;
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

const depsOf = (ctx: HandlerContext): UserSettingsDeps => ({
	accountSetting: ctx.client.accountSetting,
	accountConfig: ctx.client.accountConfig,
	classificationDefault: ctx.client.classificationDefault,
	spamDeployment: ctx.client.spam.spamDeployment,
	accounts: ctx.client.account,
	secrets: ctx.client.secrets,
	label: ctx.client.label,
});

export const UserSettingsOperations: Record<
	UserSettingsOperationIds,
	OperationHandler<UserSettingsOperationIds>
> = {
	UserSettingsOperations_getUserSettings: async (_context, ctx) =>
		readUserSettings(depsOf(ctx), ctx.identity.accountConfigId),

	UserSettingsOperations_updateUserSettings: async (context, ctx) => {
		const updated = await updateUserSettingsFor(
			depsOf(ctx),
			ctx.identity.accountConfigId,
			context.request.requestBody as UpdateUserSettingsInput,
		);
		if (!updated.ok) return badRequest(updated.error);
		return updated.value;
	},

	UserSettingsOperations_clearDefaultInvitationSender: async (
		_context,
		ctx,
	) => {
		const deps = depsOf(ctx);
		await deps.accountSetting.delete(
			ctx.identity.accountConfigId,
			AccountSettingName.DefaultInvitationSenderAccountId,
		);
		return readUserSettings(deps, ctx.identity.accountConfigId);
	},

	UserSettingsOperations_clearClassificationProvider: async (_context, ctx) => {
		const deps = depsOf(ctx);
		await clearClassification(
			deps.accountSetting,
			ctx.identity.accountConfigId,
		);
		return readUserSettings(deps, ctx.identity.accountConfigId);
	},

	UserSettingsOperations_testClassificationProvider: async (context, ctx) => {
		const tested = await testClassificationProvider(
			{
				accountSetting: ctx.client.accountSetting,
				accountConfig: ctx.client.accountConfig,
				classificationDefault: ctx.client.classificationDefault,
				secrets: ctx.client.secrets,
				logger,
			},
			ctx.identity.accountConfigId,
			context.request.requestBody as ClassificationTestInput,
		);
		if (!tested.ok) return badRequest(tested.error);
		return tested.value;
	},
};
