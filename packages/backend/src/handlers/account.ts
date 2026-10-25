import type {
	AccountResponse,
	CreateAccountInput,
	DeleteAccountResponse,
	TestConnectionInput,
	TestConnectionResponse,
	UpdateAccountInput,
} from "@remit/api-openapi-types";
import type {
	AccountItem,
	UpdateAccountInput as AccountUpdate,
	IAccountRepository,
} from "@remit/data-ports";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
} from "@remit/domain-enums";
import { logger } from "@remit/logger";
import {
	createMailOAuthService,
	microsoftProviderConfig,
	RefreshTokenError,
} from "@remit/mail-oauth-service";
import {
	ownedAccount,
	resolveConnectionCredentials,
	testImapConnection,
	testSmtpConnection,
} from "@remit/mailbox-service";
import {
	deserializeEncryptedPayload,
	type SecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { Context } from "openapi-backend";
import { deleteAccount } from "../service/account-deletion.js";
import type { RemitClient } from "../service/data-client.js";
import { fireAndForget } from "../service/fire-and-forget.js";
import { unwrap } from "../service/refusal.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type {
	AccountDetailOperationIds,
	AccountOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";
import {
	assertNoDuplicateMailbox,
	assertNotOAuthCreate,
	assertPasswordProvided,
	resolveSyncedServices,
	toAccountResponse,
} from "./account-guards.js";
import {
	loadAccountOverrides,
	upsertAccountDisplayName,
	writeAccountComposeLanguages,
	writeAccountMuted,
} from "./account-overrides.js";
import {
	loadSignatureForAccount,
	upsertAccountSignature,
} from "./account-signature.js";
import { ensureAccountConfig } from "./ensure-account-config.js";
import { resolveAccountFolderAppointments } from "./folder-role-appointments.js";

type AccountContext = HandlerContext<"sync" | "accountFanout">;

export { assertNotOAuthCreate, assertPasswordProvided, toAccountResponse };

export const triggerAccountSyncSafe = async (
	client: RemitClient<"sync">,
	accountId: string,
): Promise<void> => {
	// Best-effort: account creation must still return 200 even if the sync
	// enqueue fails. fireAndForget catches and logs every rejection loudly with
	// the alertable structured fields and never rejects, so a failure here (SQS
	// unreachable in smoke/e2e, an IAM/SQS misconfig in prod) cannot leak an
	// unhandled rejection onto an unrelated in-flight request.
	await fireAndForget(
		async () => {
			const { eventId } = await triggerAccountSync({
				queue: client.queues.sync,
				accountId,
			});
			// biome-ignore lint/plugin/no-logger-info: sync-triggered-for-new-account is an audit-grade signal
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
	account: IAccountRepository,
	secrets: SecretsService,
): Promise<TestConnectionResponse> => {
	const tokenService = createMailOAuthService(
		microsoftProviderConfig({
			clientId: process.env.MSOAUTH_CLIENT_ID ?? "",
			clientSecret: process.env.MSOAUTH_CLIENT_SECRET ?? "",
			overrides: process.env.MSOAUTH_TOKEN_ENDPOINT
				? { tokenEndpoint: process.env.MSOAUTH_TOKEN_ENDPOINT }
				: undefined,
		}),
	);

	let resolution: Awaited<ReturnType<typeof resolveConnectionCredentials>>;
	try {
		resolution = await resolveConnectionCredentials(existingAccount, {
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

	if (resolution.status === "missing") {
		return {
			imapSuccess: false,
			imapError: "oauth_not_configured",
			smtpSuccess: undefined,
		};
	}
	const credentials = resolution.credentials;

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
	if (existingAccount.smtpEnabled) {
		const smtpResult = await testSmtpConnection({
			host: existingAccount.smtpHost ?? "",
			port: existingAccount.smtpPort ?? 587,
			secure: existingAccount.smtpTls ?? false,
			user: existingAccount.smtpUsername || existingAccount.username,
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
	OperationHandler<AccountOperationIds, "sync" | "accountFanout">
> = {
	AccountOperations_createAccount: async (
		context: Context,
		ctx: AccountContext,
	): Promise<AccountResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const input = context.request.requestBody as CreateAccountInput;

		// OAuth accounts must be created via the dedicated connect flow
		assertNotOAuthCreate(input.authType);

		// Password accounts require a non-empty password
		assertPasswordProvided(input.authType, input.password);

		const syncedServices = resolveSyncedServices(
			{ authType: AccountAuthType.Password, grantedScopes: [] },
			input.syncedServices ?? [AccountService.Mail],
		);

		const { account, accountConfig, accountSetting, mailbox, secrets } =
			ctx.client;

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
			syncedServices,
			passwordHash,
			imapHost: input.imapHost,
			imapPort: input.imapPort,
			imapTls: input.imapTls,
			imapStartTls: input.imapStartTls,
			// RFC 032 Tier 2: smtpEnabled is the explicit send-capability marker.
			// Honour an explicit flag from the client; otherwise enable sending when
			// an SMTP host was supplied (the prior implicit behaviour).
			smtpEnabled: input.smtpEnabled ?? Boolean(input.smtpHost),
			smtpHost: input.smtpHost,
			smtpPort: input.smtpPort,
			smtpTls: input.smtpTls,
			smtpStartTls: input.smtpStartTls,
			smtpUsername: input.smtpUsername,
			smtpPasswordHash,
			isActive: true,
			connectionState: ConnectionState.NotAuthenticated,
		});

		// Display name lives in a per-account AccountSetting row (RFC 032), not on
		// the entity. Persist it when supplied so the response and later reads
		// surface it unchanged.
		if (input.displayName !== undefined) {
			await upsertAccountDisplayName(
				accountSetting,
				accountConfigId,
				newAccount.accountId,
				input.displayName,
			);
		}

		await triggerAccountSyncSafe(ctx.client, newAccount.accountId);

		const [overrides, folderAppointments] = await Promise.all([
			loadAccountOverrides(
				accountSetting,
				accountConfigId,
				newAccount.accountId,
			),
			resolveAccountFolderAppointments(
				{ mailbox, accountSetting },
				accountConfigId,
				newAccount.accountId,
			),
		]);
		return toAccountResponse(newAccount, {}, overrides, folderAppointments);
	},

	AccountOperations_testConnection: async (
		context: Context,
		ctx: AccountContext,
	): Promise<TestConnectionResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const input = context.request.requestBody as TestConnectionInput;

		const { account, secrets } = ctx.client;

		// Resolve password - use provided password or decrypt stored password
		let imapPassword = input.password;
		let smtpPassword = input.smtpPassword;

		if (!imapPassword && input.accountId) {
			const existingAccount = await account.get(input.accountId);
			unwrap(ownedAccount(existingAccount, accountConfigId, "read"));

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
			startTls: input.imapStartTls,
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

const encryptedSecret = async (
	secrets: RemitClient["secrets"],
	plaintext: string | undefined,
): Promise<string | undefined> =>
	plaintext
		? JSON.stringify(
				serializeEncryptedPayload(await secrets.encrypt(plaintext)),
			)
		: undefined;

type AccountSettingField =
	| "displayName"
	| "composeLanguages"
	| "muted"
	| "signaturePlainText"
	| "signatureHtml";

type AccountEntityField = Exclude<
	keyof UpdateAccountInput,
	AccountSettingField | "password" | "smtpPassword"
>;

export const AccountDetailOperations: Record<
	AccountDetailOperationIds,
	OperationHandler<AccountDetailOperationIds, "sync" | "accountFanout">
> = {
	AccountDetailOperations_updateAccount: async (
		context: Context,
		ctx: AccountContext,
	): Promise<AccountResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId } = context.request.params as { accountId: string };
		const input = context.request.requestBody as UpdateAccountInput;

		const { account, accountSetting, mailbox, secrets } = ctx.client;

		const existing = await account.get(accountId);
		unwrap(ownedAccount(existing, accountConfigId, "act"));

		const entityFields: { [K in AccountEntityField]: AccountUpdate[K] } = {
			imapHost: input.imapHost,
			imapPort: input.imapPort,
			imapTls: input.imapTls,
			imapStartTls: input.imapStartTls,
			// RFC 032 Tier 2: keep the explicit send-capability marker in sync. When a
			// caller changes the SMTP host without passing smtpEnabled, derive it from
			// host presence so the marker can't drift from the config.
			smtpEnabled:
				input.smtpEnabled ??
				(input.smtpHost === undefined ? undefined : Boolean(input.smtpHost)),
			smtpHost: input.smtpHost,
			smtpPort: input.smtpPort,
			smtpTls: input.smtpTls,
			smtpStartTls: input.smtpStartTls,
			smtpUsername: input.smtpUsername,
			isActive: input.isActive,
			syncedServices:
				input.syncedServices === undefined
					? undefined
					: resolveSyncedServices(existing, input.syncedServices),
		};
		const updates: AccountUpdate = {
			...entityFields,
			passwordHash: await encryptedSecret(secrets, input.password),
			smtpPasswordHash: await encryptedSecret(secrets, input.smtpPassword),
		};

		// Display name and the mute flag live in per-account AccountSetting rows
		// (RFC 032), not on the account entity. Display name upserts when supplied;
		// the mute flag follows the address-flag null→remove, object→set semantics
		// (the client populates setAt).
		if (input.displayName !== undefined) {
			await upsertAccountDisplayName(
				accountSetting,
				accountConfigId,
				accountId,
				input.displayName,
			);
		}
		if (input.composeLanguages !== undefined) {
			await writeAccountComposeLanguages(
				accountSetting,
				accountConfigId,
				accountId,
				input.composeLanguages,
			);
		}
		if (Object.hasOwn(input, "muted")) {
			if (input.muted !== undefined) {
				await writeAccountMuted(
					accountSetting,
					accountConfigId,
					accountId,
					input.muted,
				);
			}
		}

		// Signatures live in per-account AccountSetting rows (RFC 032), not on the
		// account entity. Persist each supplied part as a composite-named setting;
		// an empty string is a valid stored value (preserves the prior "set ''
		// stores ''" semantics — it does not delete the row).
		if (
			input.signaturePlainText !== undefined ||
			input.signatureHtml !== undefined
		) {
			await upsertAccountSignature(accountSetting, accountConfigId, accountId, {
				plainText: input.signaturePlainText,
				html: input.signatureHtml,
			});
		}

		const updated = await account.update(accountId, updates);

		const [signature, overrides, folderAppointments] = await Promise.all([
			loadSignatureForAccount(accountSetting, accountConfigId, accountId),
			loadAccountOverrides(accountSetting, accountConfigId, accountId),
			resolveAccountFolderAppointments(
				{ mailbox, accountSetting },
				accountConfigId,
				accountId,
			),
		]);
		return toAccountResponse(updated, signature, overrides, folderAppointments);
	},

	AccountDetailOperations_deleteAccount: async (
		context: Context,
		ctx: AccountContext,
	): Promise<DeleteAccountResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId } = context.request.params as { accountId: string };

		const { account } = ctx.client;

		const existing = await account.get(accountId);
		unwrap(ownedAccount(existing, accountConfigId, "act"));

		const deletedAt = Date.now();
		await deleteAccount(
			{
				account,
				queue: ctx.client.queues.accountFanout,
				log: logger,
			},
			existing,
			deletedAt,
		);

		return {
			accountId,
			deletedAt,
			message:
				"Account marked for deletion. Data cleanup will complete shortly.",
		};
	},
};
