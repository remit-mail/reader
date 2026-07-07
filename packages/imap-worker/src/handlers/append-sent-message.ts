import {
	AccountService,
	getClient,
	MailboxService,
	MailboxSpecialUseService,
	type OutboxMessageItem,
	OutboxMessageService,
} from "@remit/remit-electrodb-service";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { Logger } from "@remit/remit-logger-lambda";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { env } from "expect-env";
import nodemailer from "nodemailer";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { AppendSentMessageEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

const client = getClient();
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

const accountService = new AccountService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const outboxMessageService = new OutboxMessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const mailboxSpecialUseService = new MailboxSpecialUseService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const mailboxService = new MailboxService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

const findSentMailbox = async (
	accountId: string,
): Promise<{ mailboxId: string; fullPath: string } | null> => {
	const bySpecialUse = await mailboxSpecialUseService.findBySpecialUse(
		accountId,
		MailboxSpecialUse.Sent,
	);
	if (bySpecialUse) {
		return bySpecialUse;
	}

	const commonSentNames = [
		"Sent",
		"Sent Items",
		"Sent Messages",
		"[Gmail]/Sent Mail",
	];
	const mailboxResult = await mailboxService.listByAccount(accountId);

	for (const name of commonSentNames) {
		const found = mailboxResult.items.find(
			(m) => m.fullPath.toLowerCase() === name.toLowerCase(),
		);
		if (found) {
			return { mailboxId: found.mailboxId, fullPath: found.fullPath };
		}
	}

	return null;
};

const buildRawMessage = async (outbox: OutboxMessageItem): Promise<Buffer> => {
	const from = outbox.fromName
		? `${outbox.fromName} <${outbox.fromAddress}>`
		: outbox.fromAddress;

	const transport = nodemailer.createTransport({ streamTransport: true });

	const info = await transport.sendMail({
		from,
		to: outbox.toAddresses.join(", "),
		cc: outbox.ccAddresses?.join(", "),
		bcc: outbox.bccAddresses?.join(", "),
		replyTo: outbox.replyToAddress,
		subject: outbox.subject,
		text: outbox.textBody,
		html: outbox.htmlBody,
		messageId: `<${outbox.messageIdValue}>`,
		inReplyTo: outbox.inReplyTo ? `<${outbox.inReplyTo}>` : undefined,
		references: outbox.references?.map((r) => `<${r}>`).join(" "),
		date: outbox.sentAt ? new Date(outbox.sentAt) : new Date(),
	});

	const chunks: Buffer[] = [];
	for await (const chunk of info.message as AsyncIterable<Buffer>) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
};

export const handleAppendSentMessage = async (
	event: AppendSentMessageEvent,
	log: Logger,
): Promise<void> => {
	const { accountId, outboxMessageId } = event;

	log.info({ event: event.type, accountId, outboxMessageId }, "Handling event");

	const account = await accountService.get(accountId);
	if (isAccountDeleted(account, log)) {
		return;
	}

	const outbox = await outboxMessageService.get(
		account.accountConfigId,
		outboxMessageId,
	);
	if (outbox.status !== "sent") {
		log.info(
			{ outboxMessageId, status: outbox.status },
			"Outbox message not in sent status, skipping APPEND",
		);
		return;
	}

	const sentMailbox = await findSentMailbox(accountId);
	if (!sentMailbox) {
		log.info({ accountId }, "No Sent mailbox found, skipping IMAP APPEND");
		return;
	}

	await withOAuthLifecycle(
		buildLifecycleDeps(secrets, accountService),
		account,
		log,
		async (credentials) => {
			const scope = createConnectionScopeWithCredentials(account, credentials);

			await scope
				.getConnection()
				.then(async (connection) => {
					const rawMessage = await buildRawMessage(outbox);

					const result = await connection.append(
						sentMailbox.fullPath,
						rawMessage,
						["\\Seen"],
					);

					log.info(
						{
							outboxMessageId,
							sentMailbox: sentMailbox.fullPath,
							uid: result.uid,
							uidValidity: result.uidValidity,
						},
						"Appended sent message to Sent mailbox",
					);
				})
				.finally(() => scope.disconnect());

			// The message now lives in the IMAP Sent folder. Drop the outbox row so
			// the user does not see it twice in the UI (Outbox + Sent). Issue #178.
			await outboxMessageService.delete(
				account.accountConfigId,
				outboxMessageId,
			);
			log.info(
				{ outboxMessageId },
				"Deleted outbox row after successful APPEND to Sent",
			);
		},
	);
};
