import { inspect } from "node:util";
import type { AccountItem } from "@remit/remit-electrodb-service";
import { ConnectionState } from "@remit/domain-enums";
import {
	testImapConnection,
	testSmtpConnection,
} from "@remit/mailbox-service";
import type {
	AccountResponse,
	CreateAccountInput,
	DeleteAccountResponse,
	TestConnectionInput,
	TestConnectionResponse,
	UpdateAccountInput,
} from "@remit/api-openapi-types";
import {
	deserializeEncryptedPayload,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { logger } from "../logger.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type {
	AccountDetailOperationIds,
	AccountOperationIds,
	OperationHandler,
} from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";
import { ensureAccountConfig } from "./ensure-account-config.js";

const triggerAccountSyncSafe = async (accountId: string): Promise<void> => {
	const queueUrl = env.SQS_QUEUE_URL;
	const { eventId } = await triggerAccountSync({
		sqsClient,
		queueUrl,
		accountId,
	}).catch((error: unknown) => {
		logger.error(
			{ accountId, error: inspect(error) },
			"Failed to enqueue SYNC_MAILBOXES for new account (best-effort)",
		);
		return { eventId: undefined };
	});

	if (eventId !== undefined) {
		logger.info({ accountId, eventId }, "Sync triggered for new account");
	}
};

const toAccountResponse = (account: AccountItem): AccountResponse => ({
	accountId: account.accountId,
	accountConfigId: account.accountConfigId,
	username: account.username,
	email: account.email,
	imapHost: account.imapHost,
	imapPort: account.imapPort,
	imapTls: account.imapTls,
	imapStartTls: account.imapStartTls,
	smtpHost: account.smtpHost,
	smtpPort: account.smtpPort,
	smtpTls: account.smtpTls,
	smtpStartTls: account.smtpStartTls,
	smtpUsername: account.smtpUsername,
	signaturePlainText: account.signaturePlainText,
	signatureHtml: account.signatureHtml,
	isActive: account.isActive,
	connectionState: account.connectionState,
	lastConnectedAt: account.lastConnectedAt,
	lastSyncAt: account.lastSyncAt,
	lastError: account.lastError,
	syncPhase: account.syncPhase,
	mailboxCountTotal: account.mailboxCountTotal,
	mailboxCountSynced: account.mailboxCountSynced,
	muted: account.muted,
	createdAt: account.createdAt,
	updatedAt: account.updatedAt,
});

export const AccountOperations: Record<
	AccountOperationIds,
	OperationHandler<AccountOperationIds>
> = {
	AccountOperations_createAccount: async (
		_context: Context,
		...args: unknown[]
	): Promise<AccountResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const input = JSON.parse(event.body ?? "{}") as CreateAccountInput;

		const { account, accountConfig, secrets } = getClient();

		await ensureAccountConfig(accountConfig, accountConfigId);

		const passwordPayload = await secrets.encrypt(input.password);
		const passwordHash = JSON.stringify(
			serializeEncryptedPayload(passwordPayload),
		);

		let smtpPasswordHash: string | undefined;
		if (input.smtpPassword) {
			const smtpPayload = await secrets.encrypt(input.smtpPassword);
			smtpPasswordHash = JSON.stringify(serializeEncryptedPayload(smtpPayload));
		}

		const newAccount = await account.create({
			accountConfigId,
			email: input.email,
			username: input.username ?? input.email,
			passwordHash,
			imapHost: input.imapHost,
			imapPort: input.imapPort,
			imapTls: input.imapTls,
			imapStartTls: input.imapStartTls,
			smtpHost: input.smtpHost,
			smtpPort: input.smtpPort,
			smtpTls: input.smtpTls,
			smtpStartTls: input.smtpStartTls,
			smtpUsername: input.smtpUsername,
			smtpPasswordHash,
			isActive: true,
			connectionState: ConnectionState.NotAuthenticated,
		});

		await triggerAccountSyncSafe(newAccount.accountId);

		return toAccountResponse(newAccount);
	},

	AccountOperations_testConnection: async (
		_context: Context,
		...args: unknown[]
	): Promise<TestConnectionResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const input = JSON.parse(event.body ?? "{}") as TestConnectionInput;

		const { account, secrets } = getClient();

		// Resolve password - use provided password or decrypt stored password
		let imapPassword = input.password;
		let smtpPassword = input.smtpPassword;

		if (!imapPassword && input.accountId) {
			const existingAccount = await account.get(input.accountId);
			assertAccountOwnership(existingAccount, accountConfigId, "read");

			const payload = deserializeEncryptedPayload(
				JSON.parse(existingAccount.passwordHash),
			);
			imapPassword = await secrets.decrypt(payload);

			// Also get SMTP password if needed and available
			if (!smtpPassword && existingAccount.smtpPasswordHash) {
				const smtpPayload = deserializeEncryptedPayload(
					JSON.parse(existingAccount.smtpPasswordHash),
				);
				smtpPassword = await secrets.decrypt(smtpPayload);
			}
		}

		if (!imapPassword) {
			return {
				imapSuccess: false,
				imapError: "Password required",
				smtpSuccess: undefined,
			};
		}

		const result: TestConnectionResponse = {
			imapSuccess: false,
			smtpSuccess: undefined,
		};

		// Test IMAP connection
		const imapResult = await testImapConnection({
			host: input.imapHost,
			port: input.imapPort,
			secure: input.imapTls,
			auth: { user: input.username, pass: imapPassword },
		});

		result.imapSuccess = imapResult.success;
		if (!imapResult.success) {
			result.imapError = imapResult.error;
		}

		// Test SMTP connection if configured
		if (input.smtpHost) {
			const smtpResult = await testSmtpConnection({
				host: input.smtpHost,
				port: input.smtpPort ?? 587,
				secure: input.smtpTls ?? false,
				auth: {
					user: input.smtpUsername ?? input.username,
					pass: smtpPassword ?? imapPassword,
				},
			});

			result.smtpSuccess = smtpResult.success;
			if (!smtpResult.success) {
				result.smtpError = smtpResult.error;
			}
		}

		return result;
	},
};

export const AccountDetailOperations: Record<
	AccountDetailOperationIds,
	OperationHandler<AccountDetailOperationIds>
> = {
	AccountDetailOperations_updateAccount: async (
		context: Context,
		...args: unknown[]
	): Promise<AccountResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const input = JSON.parse(event.body ?? "{}") as UpdateAccountInput;

		const { account, secrets } = getClient();

		const existing = await account.get(accountId);
		assertAccountOwnership(existing, accountConfigId, "act");

		const updates: Record<string, unknown> = {};

		// Handle password updates
		if (input.password) {
			const payload = await secrets.encrypt(input.password);
			updates.passwordHash = JSON.stringify(serializeEncryptedPayload(payload));
		}
		if (input.smtpPassword) {
			const payload = await secrets.encrypt(input.smtpPassword);
			updates.smtpPasswordHash = JSON.stringify(
				serializeEncryptedPayload(payload),
			);
		}

		// Copy non-password fields
		const fields = [
			"displayName",
			"imapHost",
			"imapPort",
			"imapTls",
			"imapStartTls",
			"smtpHost",
			"smtpPort",
			"smtpTls",
			"smtpStartTls",
			"smtpUsername",
			"isActive",
			"signaturePlainText",
			"signatureHtml",
		] as const;

		for (const field of fields) {
			if (input[field] !== undefined) {
				updates[field] = input[field];
			}
		}

		// Handle muted flag: explicit null removes the flag, object sets it.
		// Mirrors UpdateAddressFlagsInput semantics: null → remove, object → set.
		// The client is responsible for populating setAt (same pattern as address flags).
		const remove: "muted"[] = [];
		if (Object.prototype.hasOwnProperty.call(input, "muted")) {
			if (input.muted === null) {
				remove.push("muted");
			} else if (input.muted !== undefined) {
				updates.muted = input.muted;
			}
		}

		const updated = await account.update(
			accountId,
			updates,
			remove.length > 0 ? remove : undefined,
		);
		return toAccountResponse(updated);
	},

	AccountDetailOperations_deleteAccount: async (
		context: Context,
		...args: unknown[]
	): Promise<DeleteAccountResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };

		const { account } = getClient();

		const existing = await account.get(accountId);
		assertAccountOwnership(existing, accountConfigId, "act");

		const deletedAt = Date.now();
		await account.update(accountId, {
			deletedAt,
			isActive: false,
		});

		return {
			accountId,
			deletedAt,
			message:
				"Account marked for deletion. Data cleanup will complete shortly.",
		};
	},
};
