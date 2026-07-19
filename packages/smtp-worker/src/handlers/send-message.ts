import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { deriveAddressId, deriveMessageId } from "@remit/data-ports/id";
import type { ConnectionState } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	createMailOAuthService,
	microsoftProviderConfig,
} from "@remit/mail-oauth-service";
// Subpath import, not the package root: the root barrel re-exports the whole
// IMAP sync surface (mailbox/flag/message sync, snippet/heuristics text
// processing), which drags `natural` and friends into a bundle that only
// ever calls resolveConnectionCredentials.
import {
	type AccountCredentialsDeps,
	resolveConnectionCredentials,
} from "@remit/mailbox-service/account-credentials";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { sendMail } from "@remit/smtp-service";
import { resolveSqsCredentials } from "@remit/sqs-client";
import { env } from "expect-env";
import { buildDataPortsFromEnv } from "../data-ports.js";
import type { SendMessageEvent } from "../events.js";
import { sendMessage } from "./send-message-core.js";

const ports = await buildDataPortsFromEnv();
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

// Lazy OAuth service (only instantiated when an OAuth account sends mail)
let _tokenService: ReturnType<typeof createMailOAuthService> | undefined;
const getTokenService = () => {
	if (!_tokenService) {
		_tokenService = createMailOAuthService(
			microsoftProviderConfig({
				clientId: process.env.MSOAUTH_CLIENT_ID ?? "",
				clientSecret: process.env.MSOAUTH_CLIENT_SECRET ?? "",
				overrides: process.env.MSOAUTH_TOKEN_ENDPOINT
					? { tokenEndpoint: process.env.MSOAUTH_TOKEN_ENDPOINT }
					: undefined,
			}),
		);
	}
	return _tokenService;
};

const accountService = ports.account;
const outboxService = ports.outboxMessage;
const addressService = ports.address;
const messageService = ports.message;
const envelopeService = ports.envelope;

// APPEND_SENT_MESSAGE is processed by the IMAP worker via the
// message-management queue (see remit-imap-worker/src/emit.ts).
const messageMgmtQueueUrl = env.SQS_QUEUE_URL_MESSAGE_MGMT;
const isLocalQueue = messageMgmtQueueUrl.startsWith("http://localhost");

const messageMgmtSqs = new SQSClient({
	endpoint: isLocalQueue ? new URL(messageMgmtQueueUrl).origin : undefined,
	...(isLocalQueue && { protocol: AwsQueryProtocol }),
	credentials: resolveSqsCredentials(),
});

const emitAppendSentMessage = async (
	accountId: string,
	outboxMessageId: string,
): Promise<void> => {
	const event = {
		type: "APPEND_SENT_MESSAGE" as const,
		accountId,
		outboxMessageId,
		eventId: randomUUID(),
		timestamp: Date.now(),
	};

	await messageMgmtSqs.send(
		new SendMessageCommand({
			QueueUrl: messageMgmtQueueUrl,
			MessageBody: JSON.stringify(event),
		}),
	);
};

const findMessageByHeader = async (
	accountId: string,
	messageIdHeader: string,
) => {
	const messageId = deriveMessageId(accountId, messageIdHeader);
	return messageService.get(messageId).catch((error: unknown) => {
		if ((error as { name?: string })?.name === "NotFoundError") return null;
		throw error;
	});
};

const getEnvelopeFromEmail = async (
	messageId: string,
): Promise<string | null> => {
	const data = await envelopeService
		.getMessageData(messageId)
		.catch((error: unknown) => {
			if ((error as { name?: string })?.name === "NotFoundError") return null;
			throw error;
		});
	if (!data) return null;
	const fromEntry = data.envelopeAddress.find(
		(addr) => addr.addressRole === "from",
	);
	return fromEntry?.normalizedEmail ?? null;
};

/**
 * Build AccountCredentialsDeps for the SMTP send path.
 * Uses resolveConnectionCredentials — the single authType branch in the codebase.
 * Rotation is persisted via accountService.update so the next IMAP sync picks
 * up the new token without needing a separate refresh.
 */
const buildCredentialDeps = (): AccountCredentialsDeps => ({
	secrets,
	tokenService: getTokenService(),
	persistRotatedToken: async (accountId, encryptedHash, updatedAt) => {
		await accountService.update(accountId, {
			oauthRefreshTokenHash: encryptedHash,
			oauthTokenUpdatedAt: updatedAt,
		});
	},
});

export const handleSendMessage = (
	event: SendMessageEvent,
	log: Logger,
): Promise<void> => {
	const credentialDeps = buildCredentialDeps();
	return sendMessage(event, log, {
		getOutbox: (accountConfigId, id) => outboxService.get(accountConfigId, id),
		getAccount: (id) => accountService.get(id),
		updateOutbox: (accountConfigId, id, patch) =>
			outboxService.update(accountConfigId, id, patch),
		updateOutboxStatus: (accountConfigId, id, status) =>
			outboxService.updateStatus(accountConfigId, id, status),
		markOutboxSent: (accountConfigId, id, fields) =>
			outboxService.markSent(accountConfigId, id, fields),
		secrets,
		resolveCredentials: (account) =>
			resolveConnectionCredentials(account, credentialDeps),
		updateConnectionState: async (id, state) => {
			await accountService.update(id, {
				connectionState:
					state as (typeof ConnectionState)[keyof typeof ConnectionState],
			});
		},
		send: sendMail,
		emitAppendSentMessage,
		engagement: {
			resolveAddressId: deriveAddressId,
			incrementOutboundCount: (accountConfigId, addressId, now) =>
				addressService.incrementOutboundCount(accountConfigId, addressId, now),
			incrementReplyCount: (accountConfigId, addressId, now) =>
				addressService.incrementReplyCount(accountConfigId, addressId, now),
			findMessageByHeader,
			getEnvelopeFromEmail,
		},
	});
};
