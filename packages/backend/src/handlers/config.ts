import { inspect } from "node:util";
import {
	type AccountConfigItem,
	type AccountItem,
	NotFoundError,
} from "@remit/remit-electrodb-service";
import { AccountAuthType } from "@remit/domain-enums";
import { logger } from "@remit/remit-logger-lambda";
import type {
	AccountConfigResponse,
	AccountResponse,
	ConfigDescriptionResponse,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent, getSubFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type { ConfigOperationIds, OperationHandler } from "../types.js";

const triggerAccountSyncForConfig = async (
	accountId: string,
): Promise<void> => {
	const { eventId } = await triggerAccountSync({
		sqsClient,
		queueUrl: env.SQS_QUEUE_URL,
		accountId,
	});
	logger.info({ accountId, eventId }, "Sync triggered on config load");
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
	};
};

// SECURITY: passwordHash, oauthRefreshTokenHash, and smtpPasswordHash are
// intentionally omitted — never expose token material in API responses.
const toAccountResponse = (account: AccountItem): AccountResponse => ({
	accountId: account.accountId,
	accountConfigId: account.accountConfigId,
	username: account.username,
	email: account.email,
	authType: account.authType ?? AccountAuthType.Password,
	imapHost: account.imapHost,
	imapPort: account.imapPort,
	imapTls: account.imapTls,
	imapStartTls: account.imapStartTls,
	smtpHost: account.smtpHost,
	smtpPort: account.smtpPort,
	smtpTls: account.smtpTls,
	smtpStartTls: account.smtpStartTls,
	smtpUsername: account.smtpUsername,
	isActive: account.isActive,
	connectionState: account.connectionState,
	lastConnectedAt: account.lastConnectedAt,
	lastSyncAt: account.lastSyncAt,
	lastError: account.lastError,
	syncPhase: account.syncPhase,
	mailboxCountTotal: account.mailboxCountTotal,
	mailboxCountSynced: account.mailboxCountSynced,
	createdAt: account.createdAt,
	updatedAt: account.updatedAt,
});

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
		const description = await getClient()
			.accountConfig.describe(accountConfigId)
			.catch((err) => {
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

		// Trigger sync for all active accounts. The read response below does not
		// depend on the trigger succeeding, so we don't await it — but a failure
		// here (SQS/IAM misconfig) silently stops ALL sync, so it must be loud and
		// alertable rather than a bare swallowed log. Each rejection is surfaced as
		// a distinct structured error carrying the SDK error name/code on dedicated
		// fields plus a stable `alert` discriminator a CloudWatch metric filter /
		// alarm can key off.
		void Promise.allSettled(
			activeAccounts.map((acc) => triggerAccountSyncForConfig(acc.accountId)),
		).then((settled) => {
			for (const [index, result] of settled.entries()) {
				if (result.status === "fulfilled") continue;
				const err = result.reason;
				logger.error(
					{
						alert: "sync_trigger_failed",
						source: "config_load",
						accountId: activeAccounts[index]?.accountId,
						accountConfigId,
						errorName: (err as { name?: string })?.name,
						errorCode:
							(err as { Code?: string; code?: string })?.Code ??
							(err as { code?: string })?.code,
						error: inspect(err),
					},
					"Failed to trigger account sync on config load",
				);
			}
		});

		return {
			accountConfig: toAccountConfigResponse(accountConfig),
			accounts: activeAccounts.map(toAccountResponse),
		};
	},
};
