import type { SQSClient } from "@aws-sdk/client-sqs";
import type {
	AccountConfigResponse,
	ConfigDescriptionResponse,
	ConfigImportReport,
} from "@remit/api-openapi-types";
import type { ReaderConfigDocument } from "@remit/config-format";
import {
	importConfig,
	pendingImportOf,
	readConfigForExport,
} from "@remit/config-transfer";
import type { AccountConfigItem, MailboxItem } from "@remit/data-ports";
import { ConfigNotEmptyError, NotFoundError } from "@remit/data-ports/errors";
import type { CanonicalMailboxRoleValue } from "@remit/data-ports/folder-role";
import { logger } from "@remit/logger-lambda";
import {
	hasStoredCredential,
	type StoredCredentialFields,
} from "@remit/mailbox-service";
import {
	EMBEDDING_PROVIDER_OFF,
	readEmbeddingProviderFromEnv,
} from "@remit/search-service/from-env";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent, getSubFromEvent } from "../auth.js";
import { embedAnchorText } from "../service/config-import.js";
import { getClient } from "../service/data-client.js";
import { exportIdentity } from "../service/export-identity.js";
import { fireAndForget } from "../service/fire-and-forget.js";
import { sqsClient } from "../service/sqs.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type { ConfigOperationIds, OperationHandler } from "../types.js";
import { toAccountResponse } from "./account-guards.js";
import {
	type AccountOverrides,
	groupAccountOverrides,
} from "./account-overrides.js";
import {
	type AccountSignature,
	groupSignaturesByAccount,
} from "./account-signature.js";
import {
	groupFolderAppointmentsByAccount,
	resolveFolderAppointments,
	writeFolderRoleAppointment,
} from "./folder-role-appointments.js";

type StructuredLog = (fields: Record<string, unknown>, message: string) => void;

interface ConfigSyncTriggerDeps {
	sqsClient: SQSClient;
	queueUrl: string;
	logger: { info: StructuredLog; error: StructuredLog };
}

const defaultConfigSyncTriggerDeps = (): ConfigSyncTriggerDeps => ({
	sqsClient,
	queueUrl: env.SQS_QUEUE_URL,
	logger,
});

/**
 * Fire-and-forget sync trigger for the accounts surfaced by GET /config.
 *
 * GET /config is a READ: its response is already computed and does not depend
 * on the trigger succeeding. A failure here (the SQS queue unreachable in
 * smoke/e2e, an IAM/SQS misconfig in prod) must therefore never reach the read
 * response — but it also silently stops ALL sync, so it has to be loud and
 * alertable rather than swallowed.
 *
 * This helper is fully self-contained: it catches every per-account rejection
 * internally and resolves to void, so the caller can `void`-fire it with no
 * chance of an unhandled rejection escaping. The dev/Lambda runtime shares one
 * event loop, so an escaped rejection lands on whatever request is active when
 * the deferred SQS retry finally fails — which is how a `/config` enqueue
 * failure ended up 500-ing unrelated reads like `/outbox` and `/threads`.
 *
 * Each failure is logged as a distinct structured error carrying the SDK error
 * name/code on dedicated fields plus a stable `alert: "sync_trigger_failed"`
 * discriminator a CloudWatch metric filter / alarm can key off.
 *
 * An account storing no credential is not enqueued at all (issue #1120): the
 * import wizard lands accounts without a password by design, and the client
 * polls this read while the user is still typing one. The guard is the stored
 * credential rather than `connectionState`, which stays `credentials_missing`
 * until a connect succeeds — see `hasStoredCredential`.
 */
export const triggerConfigLoadSyncs = async (
	accountConfigId: string,
	accounts: ReadonlyArray<{ accountId: string } & StoredCredentialFields>,
	deps: ConfigSyncTriggerDeps = defaultConfigSyncTriggerDeps(),
): Promise<void> => {
	await Promise.all(
		accounts.filter(hasStoredCredential).map(({ accountId }) =>
			fireAndForget(
				async () => {
					const { eventId } = await triggerAccountSync({
						sqsClient: deps.sqsClient,
						queueUrl: deps.queueUrl,
						accountId,
					});
					deps.logger.info(
						{ accountId, eventId },
						"Sync triggered on config load",
					);
				},
				{
					source: "config_load",
					message: "Failed to trigger account sync on config load",
					ids: { accountId, accountConfigId },
					logger: deps.logger,
				},
			),
		),
	);
};

const toAccountConfigResponse = (
	config: AccountConfigItem,
): AccountConfigResponse => ({
	accountConfigId: config.accountConfigId,
	userId: config.userId,
	name: config.name,
	state: ((config as unknown as { state?: string }).state ??
		"active") as AccountConfigResponse["state"],
	createdAt: config.createdAt,
	updatedAt: config.updatedAt,
});

/**
 * Returned by GET /config when no AccountConfig row exists yet for this user.
 * GET must never mutate state, so instead of creating a row we synthesize a
 * stable, empty shape the frontend can render as a "no accounts yet" state.
 * The POST account-creation flow will materialize the real row when the user
 * adds their first account.
 */
const emptyConfigResponse = (
	accountConfigId: string,
	event: APIGatewayProxyEvent,
): ConfigDescriptionResponse => {
	const now = Date.now();
	const userId = getSubFromEvent(event) ?? accountConfigId;
	return {
		accountConfig: {
			accountConfigId,
			userId,
			state: "active",
			createdAt: now,
			updatedAt: now,
		},
		accounts: [],
		semanticSearchEnabled: semanticSearchEnabled(),
	};
};

/**
 * Whether this instance embeds anything, read from the same
 * `SEARCH_EMBEDDING_PROVIDER` the search-index worker and the `remit` wrapper
 * read. It rides GET /config because the semantic surfaces need it before they
 * have a query to send: an off instance stores no vectors, so the Organize
 * widen and semantic filters have nothing to read, and a client that learns
 * that only from an empty result cannot tell it from a mailbox with nothing
 * similar in it (#1068).
 */
const semanticSearchEnabled = (): boolean =>
	readEmbeddingProviderFromEnv() !== EMBEDDING_PROVIDER_OFF;

export const ConfigOperations: Record<
	ConfigOperationIds,
	OperationHandler<ConfigOperationIds>
> = {
	ConfigOperations_getConfig: async (
		_context: Context,
		...args: unknown[]
	): Promise<ConfigDescriptionResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const client = await getClient();
		const description = await client.accountConfig
			.describe(accountConfigId)
			.catch((err: unknown) => {
				if (err instanceof NotFoundError) return undefined;
				throw err;
			});

		if (!description || description.accountConfig.length === 0) {
			return emptyConfigResponse(accountConfigId, event);
		}

		const accountConfig = description.accountConfig[0];
		if (!accountConfig) {
			return emptyConfigResponse(accountConfigId, event);
		}

		// Filter out deleted accounts (tombstone pattern)
		const activeAccounts = description.account.filter(
			(acc) => acc.deletedAt === undefined,
		);

		// Signatures and the display-name/mute overrides are stored per-account in
		// AccountSetting rows (RFC 032). Load the whole set for this config once and
		// key both by accountId so the account mapping below surfaces each without
		// an N+1. The per-account folder-role map (RFC 032
		// exclusive-folder-appointment, #976) rides the same settings rows, grouped
		// the same way.
		const allSettings =
			await client.accountSetting.listByAccountConfig(accountConfigId);
		const signaturesByAccount = groupSignaturesByAccount(allSettings);
		const overridesByAccount = groupAccountOverrides(allSettings);
		const appointmentsByAccount = groupFolderAppointmentsByAccount(allSettings);
		const signatureOf = (accountId: string): AccountSignature =>
			signaturesByAccount.get(accountId) ?? {};
		const overridesOf = (accountId: string): AccountOverrides =>
			overridesByAccount.get(accountId) ?? {};

		// One mailbox list per account, fetched in parallel: `findFolderForRole`
		// needs each account's folders to fill any role the user hasn't appointed
		// yet (RFC 032: "the map is never empty for a normal provider").
		const mailboxesByAccount = new Map<string, MailboxItem[]>(
			await Promise.all(
				activeAccounts.map(
					async (acc): Promise<[string, MailboxItem[]]> => [
						acc.accountId,
						await client.mailbox.listAllByAccount(acc.accountId),
					],
				),
			),
		);

		// Fire-and-forget: a failed sync enqueue must never fail this read.
		// triggerConfigLoadSyncs swallows nothing — it logs each failure loudly
		// with an alertable structured field — but it also never rejects, so the
		// `void` here cannot leak an unhandled rejection into a later request.
		void triggerConfigLoadSyncs(accountConfigId, activeAccounts);

		// An import that named folders IMAP had not produced yet rides the config
		// read rather than a route of its own, so nothing has to poll for it.
		const pendingImport = pendingImportOf(
			await client.configImport.listByAccountConfig(accountConfigId),
		);

		return {
			accountConfig: toAccountConfigResponse(accountConfig),
			semanticSearchEnabled: semanticSearchEnabled(),
			...(pendingImport ? { pendingImport } : {}),
			accounts: activeAccounts.map((acc) =>
				toAccountResponse(
					acc,
					signatureOf(acc.accountId),
					overridesOf(acc.accountId),
					resolveFolderAppointments(
						appointmentsByAccount.get(acc.accountId) ?? new Map(),
						mailboxesByAccount.get(acc.accountId) ?? [],
					),
				),
			),
		};
	},

	ConfigOperations_exportConfig: async (
		_context: Context,
		...args: unknown[]
	): Promise<{ schemaVersion: number; document: ReaderConfigDocument }> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const client = await getClient();
		const document = await readConfigForExport(
			client,
			accountConfigId,
			exportIdentity(),
		);
		return { schemaVersion: document.schemaVersion, document };
	},

	ConfigOperations_importConfig: async (
		context: Context,
		...args: unknown[]
	): Promise<ConfigImportReport> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const body = (context.request.requestBody ?? {}) as {
			mode?: "validate" | "apply";
			onExisting?: "abort" | "merge";
			document?: unknown;
		};
		const client = await getClient();

		const outcome = await importConfig(
			{
				repositories: client,
				// Passed through as-is, undefined included: a backend with no
				// cross-entity transaction writes without one, and the report words
				// what survived a failure from whether this is here.
				transaction: client.writeSet,
				appointFolderRole: (
					configId,
					accountId,
					role,
					mailboxId,
					lastKnownPath,
				) =>
					writeFolderRoleAppointment(
						client.accountSetting,
						configId,
						accountId,
						role as CanonicalMailboxRoleValue,
						mailboxId,
						lastKnownPath,
					),
				embedAnchor: embedAnchorText,
			},
			{
				accountConfigId,
				userId: getSubFromEvent(event) ?? accountConfigId,
				document: body.document,
				mode: body.mode ?? "validate",
				onExisting: body.onExisting ?? "abort",
			},
		);

		if (outcome.outcome === "conflict") {
			throw new ConfigNotEmptyError(
				outcome.conflict.message,
				outcome.conflict.details,
			);
		}
		return outcome.report;
	},
};
