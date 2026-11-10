import type {
	UpdateUserSettingsInput,
	UserSettingsResponse,
} from "@remit/api-openapi-types";
import {
	invitationSenderInEffect,
	sendingAccountFor,
} from "@remit/calendar-service";
import type {
	IAccountRepository,
	IAccountSettingRepository,
} from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import { AccountSettingName } from "@remit/domain-enums";
import type { SecretsService } from "@remit/secrets-service";
import type {
	HandlerContext,
	OperationHandler,
	UserSettingsOperationIds,
} from "../types.js";
import { badRequest } from "./calendar.js";
import {
	classificationPresetsResponse,
	classificationResponse,
	clearClassification,
	decideClassificationChange,
	readStoredClassification,
	writeClassificationChange,
} from "./classification-settings.js";

export interface UserSettingsDeps {
	accountSetting: Pick<
		IAccountSettingRepository,
		"get" | "getMany" | "upsert" | "delete"
	>;
	accounts: Pick<IAccountRepository, "listAllByAccountConfig">;
	secrets: Pick<SecretsService, "encrypt">;
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
	const inEffect = invitationSenderInEffect(
		await deps.accounts.listAllByAccountConfig(accountConfigId),
		chosen,
	);
	return {
		...(inEffect && { defaultInvitationSenderAccountId: inEffect.accountId }),
		defaultInvitationSenderChosen:
			inEffect !== undefined && inEffect.accountId === chosen,
		classificationPresets: classificationPresetsResponse(),
		classification: classificationResponse(
			await readStoredClassification(deps.accountSetting, accountConfigId),
		),
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
		input,
		await readStoredClassification(deps.accountSetting, accountConfigId),
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
	accounts: ctx.client.account,
	secrets: ctx.client.secrets,
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
};
