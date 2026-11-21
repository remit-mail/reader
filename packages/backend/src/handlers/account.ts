import type {
	AccountResponse,
	CreateAccountInput,
	DeleteAccountResponse,
	TestConnectionInput,
	TestConnectionResponse,
	UpdateAccountInput,
} from "@remit/api-openapi-types";
import type { Context } from "openapi-backend";
import {
	createAccountFor,
	deleteAccountFor,
	testConnectionFor,
	triggerAccountSyncSafe,
	updateAccountFor,
} from "../service/account-operations.js";
import type { QueueName } from "../service/queues.js";
import type {
	AccountDetailOperationIds,
	AccountOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";

export { triggerAccountSyncSafe };

export const AccountOperations = {
	AccountOperations_createAccount: async (
		context: Context,
		ctx: HandlerContext<"sync">,
	): Promise<AccountResponse> =>
		createAccountFor(
			ctx.client,
			ctx.identity.accountConfigId,
			context.request.requestBody as CreateAccountInput,
		),
	AccountOperations_testConnection: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<TestConnectionResponse> =>
		testConnectionFor(
			ctx.client,
			ctx.identity.accountConfigId,
			context.request.requestBody as TestConnectionInput,
			ctx.config.msOAuth,
		),
} satisfies Record<
	AccountOperationIds,
	OperationHandler<AccountOperationIds, QueueName>
>;

export const AccountDetailOperations = {
	AccountDetailOperations_updateAccount: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<AccountResponse> => {
		const { accountId } = context.request.params as { accountId: string };
		return updateAccountFor(
			ctx.client,
			ctx.identity.accountConfigId,
			accountId,
			context.request.requestBody as UpdateAccountInput,
		);
	},
	AccountDetailOperations_deleteAccount: async (
		context: Context,
		ctx: HandlerContext<"accountFanout">,
	): Promise<DeleteAccountResponse> => {
		const { accountId } = context.request.params as { accountId: string };
		return deleteAccountFor(
			ctx.client,
			ctx.identity.accountConfigId,
			accountId,
		);
	},
} satisfies Record<
	AccountDetailOperationIds,
	OperationHandler<AccountDetailOperationIds, QueueName>
>;
