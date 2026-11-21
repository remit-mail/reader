import type {
	ClassificationTestInput,
	UpdateUserSettingsInput,
} from "@remit/api-openapi-types";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { AccountSettingName } from "@remit/domain-enums";
import { requireOperator } from "../auth.js";
import {
	clearClassificationProviderFor,
	readUserSettings,
	testClassificationProviderFor,
	updateUserSettingsFor,
	userSettingsDepsOf,
} from "../service/user-settings-operations.js";
import type {
	OperationHandler,
	PersonSettingsOperationIds,
	UserSettingsOperationIds,
} from "../types.js";
import { badRequest } from "./calendar.js";

export type { UserSettingsOutcome } from "../service/user-settings-operations.js";
export {
	chosenInvitationSender,
	updateUserSettingsFor,
} from "../service/user-settings-operations.js";

export const UserSettingsOperations: Record<
	UserSettingsOperationIds,
	OperationHandler<UserSettingsOperationIds>
> = {
	UserSettingsOperations_getUserSettings: async (_context, ctx) =>
		readUserSettings(
			userSettingsDepsOf(ctx.client),
			ctx.identity.accountConfigId,
		),

	UserSettingsOperations_updateUserSettings: async (context, ctx) => {
		const updated = await updateUserSettingsFor(
			userSettingsDepsOf(ctx.client),
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
		const deps = userSettingsDepsOf(ctx.client);
		await deps.accountSetting.delete(
			ctx.identity.accountConfigId,
			AccountSettingName.DefaultInvitationSenderAccountId,
		);
		return readUserSettings(deps, ctx.identity.accountConfigId);
	},

	UserSettingsOperations_clearClassificationProvider: async (_context, ctx) =>
		clearClassificationProviderFor(
			userSettingsDepsOf(ctx.client),
			ctx.identity.accountConfigId,
		),

	UserSettingsOperations_testClassificationProvider: async (context, ctx) => {
		const tested = await testClassificationProviderFor(
			ctx.client,
			ctx.identity.accountConfigId,
			context.request.requestBody as ClassificationTestInput,
		);
		if (!tested.ok) return badRequest(tested.error);
		return tested.value;
	},
};

export const PersonSettingsOperations: Record<
	PersonSettingsOperationIds,
	OperationHandler<PersonSettingsOperationIds>
> = {
	PersonSettingsOperations_getPersonSettings: async (context, ctx) => {
		requireOperator(ctx);
		return readUserSettings(
			userSettingsDepsOf(ctx.client),
			deriveAccountConfigId(context.request.params.userId),
		);
	},

	PersonSettingsOperations_updatePersonSettings: async (context, ctx) => {
		requireOperator(ctx);
		const updated = await updateUserSettingsFor(
			userSettingsDepsOf(ctx.client),
			deriveAccountConfigId(context.request.params.userId),
			context.request.requestBody as UpdateUserSettingsInput,
		);
		if (!updated.ok) return badRequest(updated.error);
		return updated.value;
	},

	PersonSettingsOperations_clearPersonClassificationProvider: async (
		context,
		ctx,
	) => {
		requireOperator(ctx);
		return clearClassificationProviderFor(
			userSettingsDepsOf(ctx.client),
			deriveAccountConfigId(context.request.params.userId),
		);
	},
};
