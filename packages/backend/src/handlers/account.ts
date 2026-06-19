import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
	AccountItem,
	AccountService,
} from "@remit/remit-electrodb-service";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import { logger } from "@remit/remit-logger-lambda";
import {
	createMailOAuthService,
	microsoftProviderConfig,
	RefreshTokenError,
} from "@remit/mail-oauth-service";
import {
	resolveConnectionCredentials,
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
	type SecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import { fireAndForget } from "../service/fire-and-forget.js";
import { sqsClient } from "../service/sqs.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type {
	AccountDetailOperationIds,
	AccountOperationIds,
	OperationHandler,
} from "../types.js";
import {
	assertNoDuplicateMailbox,
	assertNotOAuthCreate,
	assertPasswordProvided,
	toAccountResponse,
} from "./account-guards.js";
import { assertAccountOwnership } from "./account-ownership.js";
import { ensureAccountConfig } from "./ensure-account-config.js";

export { assertNotOAuthCreate, assertPasswordProvided, toAccountResponse };

export const triggerAccountSyncSafe = async (
	accountId: string,
): Promise<void> => {
	const queueUrl = env.SQS_QUEUE_URL;
	// Best-effort: account creation must still return 200 even if the sync
	// enqueue fails. fireAndForget catches and logs every rejection loudly with
	// the alertable structured fields and never rejects, so a failure here (SQS
	// unreachable in smoke/e2e, an IAM/SQS misconfig in prod) cannot leak an
	// unhandled rejection onto an unrelated in-flight request.
	await fireAndForget(
		async () => {
			const { eventId } = await triggerAccountSync({
				sqsClient,
				queueUrl,
				accountId,
			});
			logger.info({ accountId, eventId }, "Sync triggered for new account");
		},
		{
			source: "account_create",
			message: "Failed to enqueue SYNC_MAILBOXES for new account (best-effort)",
			ids: { accountId },
		},
	);
};

/**
 * Test connectivity for an OAuth (Microsoft) account.
 *
 * Mints an access token from the stored refresh token via
 * resolveConnectionCredentials (the single authType branch), then runs the
 * IMAP — and, when configured, SMTP — connection tests with those credentials.
 *
 * A revoked / expired refresh token surfaces as RefreshTokenError; the
 * reauth-required case is mapped to the distinct `reauth_required` error code
 * so the UI can route the user into the OAuth re-auth flow.
 *
 * MSOAUTH_* env vars are only present in deployed Lambdas; fall back to "".
 */
const testOAuthConnection = async (
	existingAccount: AccountItem,
	account: AccountService,
	secrets: SecretsService,
): Promise<TestConnectionResponse> => {
	if (!existingAccount.oauthRefreshTokenHash) {
		return {
			imapSuccess: false,
			imapError: "oauth_not_configured",
			smtpSuccess: undefined,
		};
	}

	const tokenService = createMailOAuthService(
		microsoftProviderConfig({
			clientId: process.env.MSOAUTH_CLIENT_ID ?? "",
			clientSecret: process.env.MSOAUTH_CLIENT_SECRET ?? "",
			overrides: process.env.MSOAUTH_TOKEN_ENDPOINT
				? { tokenEndpoint: process.env.MSOAUTH_TOKEN_ENDPOINT }
				: undefined,
		}),
	);

	let credentials: Awaited<ReturnType<typeof resolveConnectionCredentials>>;
	try {
		credentials = await resolveConnectionCredentials(existingAccount, {
			secrets,
			tokenService,
			persistRotatedToken: async (id, encryptedHash, updatedAt) => {
				await account.update(id, {
					oauthRefreshTokenHash: encryptedHash,
					oauthTokenUpdatedAt: updatedAt,
				});
			},
		});
	} catch (err) {
		if (
			err instanceof RefreshTokenError &&
			err.error.kind === "reauth-required"
		) {
			return {
				imapSuccess: false,
				imapError: "reauth_required",
				smtpSuccess: undefined,
			};
		}
		throw err;
	}

	const result: TestConnectionResponse = {
		imapSuccess: false,
		smtpSuccess: undefined,
	};

	const imapResult = await testImapConnection({
		host: existingAccount.imapHost,
		port: existingAccount.imapPort,
		secure: existingAccount.imapTls,
		user: existingAccount.username,
		credentials,
	});
	result.imapSuccess = imapResult.success;
	if (!imapResult.success) {
		result.imapError = imapResult.error;
	}

	// OAuth accounts share the same access token for IMAP and SMTP.
	if (existingAccount.smtpHost) {
		const smtpResult = await testSmtpConnection({
			host: existingAccount.smtpHost,
			port: existingAccount.smtpPort ?? 587,
			secure: existingAccount.smtpTls ?? false,
			user: existingAccount.smtpUsername ?? existingAccount.username,
			credentials,
		});
		result.smtpSuccess = smtpResult.success;
		if (!smtpResult.success) {
			result.smtpError = smtpResult.error;
		}
	}

	return result;
};

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

		// OAuth accounts must be created via the dedicated connect flow
		assertNotOAuthCreate(input.authType);

		// Password accounts require a non-empty password
		assertPasswordProvided(input.authType, input.password);

		const { account, accountConfig, secrets } = getClient();

		await ensureAccountConfig(accountConfig, accountConfigId);

		// Reject re-onboarding the same mailbox-in-the-same-place. Message
		// identity is account-scoped (#633), so duplicate onboards are no longer
		// incidentally deduped — this is the explicit replacement (#635).
		const existingAccounts =
			await account.listAllByAccountConfig(accountConfigId);
		assertNoDuplicateMailbox(existingAccounts, {
			imapHost: input.imapHost,
			username: input.username ?? input.email,
		});

		// biome-ignore lint/style/noNonNullAssertion: guard above ensures password is set for password-auth accounts
		const passwordPayload = await secrets.encrypt(input.password!);
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
			authType: AccountAuthType.Password,
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

			const authType = existingAccount.authType ?? "password";
			if (authType === "oauthMicrosoft") {
				return testOAuthConnection(existingAccount, account, secrets);
			}

			if (existingAccount.passwordHash) {
				const payload = deserializeEncryptedPayload(
					JSON.parse(existingAccount.passwordHash),
				);
				imapPassword = await secrets.decrypt(payload);
			}

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
			user: input.username,
			credentials: { kind: "password", password: imapPassword },
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
				user: input.smtpUsername ?? input.username,
				credentials: {
					kind: "password",
					password: smtpPassword ?? imapPassword,
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

		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: env.SQS_QUEUE_URL_ACCOUNT_FANOUT,
				MessageBody: JSON.stringify({
					type: "AccountDataPurge",
					accountId,
					accountConfigId,
				}),
			}),
		);
		logger.info({ accountId, accountConfigId }, "Account data purge initiated");

		return {
			accountId,
			deletedAt,
			message:
				"Account marked for deletion. Data cleanup will complete shortly.",
		};
	},
};
