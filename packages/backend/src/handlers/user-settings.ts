import type {
	UpdateUserSettingsInput,
	UserSettingsResponse,
} from "@remit/api-openapi-types";
import type {
	IAccountRepository,
	IAccountSettingRepository,
} from "@remit/data-ports";
import { AccountService, AccountSettingName } from "@remit/domain-enums";
import type {
	HandlerContext,
	OperationHandler,
	UserSettingsOperationIds,
} from "../types.js";
import { badRequest } from "./calendar.js";

export interface UserSettingsDeps {
	accountSetting: Pick<IAccountSettingRepository, "get" | "upsert" | "delete">;
	account: Pick<IAccountRepository, "listAllByAccountConfig">;
}

const stringValueOf = (value: unknown): string => {
	if (typeof value !== "object" || value === null) return "";
	const inner = Reflect.get(value, "value");
	return Reflect.get(value, "kind") === "String" && typeof inner === "string"
		? inner
		: "";
};

export const readUserSettings = async (
	deps: UserSettingsDeps,
	accountConfigId: string,
): Promise<UserSettingsResponse> => ({
	defaultInvitationSenderAccountId: stringValueOf(
		(
			await deps.accountSetting.get(
				accountConfigId,
				AccountSettingName.DefaultInvitationSenderAccountId,
			)
		)?.value,
	),
});

export type UserSettingsOutcome =
	| { ok: true; value: UserSettingsResponse }
	| { ok: false; error: { code: string; message: string } };

export const updateUserSettingsFor = async (
	deps: UserSettingsDeps,
	accountConfigId: string,
	input: UpdateUserSettingsInput,
): Promise<UserSettingsOutcome> => {
	const sender = input.defaultInvitationSenderAccountId;
	if (sender === "") {
		await deps.accountSetting.delete(
			accountConfigId,
			AccountSettingName.DefaultInvitationSenderAccountId,
		);
	}
	if (sender !== undefined && sender !== "") {
		const account = (
			await deps.account.listAllByAccountConfig(accountConfigId)
		).find((candidate) => candidate.accountId === sender);
		if (!account || !account.syncedServices.includes(AccountService.Mail)) {
			return {
				ok: false,
				error: {
					code: "UnknownSender",
					message: `no account ${sender} here that sends mail, so invitations cannot go out from it`,
				},
			};
		}
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
	account: ctx.client.account,
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
};
