import { randomUUID } from "node:crypto";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
	type AccountConfigItem,
	type AccountItem,
	NotFoundError,
} from "@remit/remit-electrodb-service";
import type {
	AccountConfigResponse,
	AccountResponse,
	ConfigDescriptionResponse,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent, getSubFromEvent } from "../auth.js";
import { logger } from "../logger.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import type { ConfigOperationIds, OperationHandler } from "../types.js";

const triggerAccountSync = async (accountId: string): Promise<void> => {
	const event = {
		type: "SYNC_MAILBOXES",
		eventId: randomUUID(),
		timestamp: Date.now(),
		accountId,
	};

	await sqsClient.send(
		new SendMessageCommand({
			QueueUrl: env.SQS_QUEUE_URL,
			MessageBody: JSON.stringify(event),
		}),
	);

	logger.info(
		{ accountId, eventId: event.eventId },
		"Sync triggered on config load",
	);
};

const toAccountConfigResponse = (
	config: AccountConfigItem,
): AccountConfigResponse => ({
	accountConfigId: config.accountConfigId,
	userId: config.userId,
	name: config.name,
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
			createdAt: now,
			updatedAt: now,
		},
		accounts: [],
	};
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
	isActive: account.isActive,
	connectionState: account.connectionState,
	lastConnectedAt: account.lastConnectedAt,
	lastSyncAt: account.lastSyncAt,
	lastError: account.lastError,
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

		// Trigger sync for all active accounts (fire and forget)
		Promise.all(
			activeAccounts.map((acc) => triggerAccountSync(acc.accountId)),
		).catch((err) =>
			logger.error({ err }, "Failed to trigger syncs on config load"),
		);

		return {
			accountConfig: toAccountConfigResponse(accountConfig),
			accounts: activeAccounts.map(toAccountResponse),
		};
	},
};
