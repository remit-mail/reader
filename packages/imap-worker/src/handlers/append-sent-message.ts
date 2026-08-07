import { getClient } from "@remit/backend/client";
import type {
	IMailboxRepository,
	IMailboxSpecialUseRepository,
} from "@remit/data-ports";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	buildMailMessage,
	renderRawMessage,
} from "@remit/smtp-service/message-builder";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { AppendSentMessageEvent } from "../events.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

const findSentMailbox = async (
	mailboxSpecialUseService: IMailboxSpecialUseRepository,
	mailboxService: IMailboxRepository,
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

export interface AppendSentMessageDeps {
	getClient: typeof getClient;
	buildLifecycleDeps: typeof buildLifecycleDeps;
	withOAuthLifecycle: typeof withOAuthLifecycle;
	createConnectionScope: typeof createConnectionScopeWithCredentials;
}

const defaultDeps: AppendSentMessageDeps = {
	getClient,
	buildLifecycleDeps,
	withOAuthLifecycle,
	createConnectionScope: createConnectionScopeWithCredentials,
};

export const handleAppendSentMessage = async (
	event: AppendSentMessageEvent,
	log: Logger,
	deps: AppendSentMessageDeps = defaultDeps,
): Promise<void> => {
	const {
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: createConnectionScopeWithCredentials,
	} = deps;

	const {
		account: accountService,
		outboxMessage: outboxMessageService,
		outboxAttachment: outboxAttachmentService,
		mailboxSpecialUse: mailboxSpecialUseService,
		mailbox: mailboxService,
		secrets,
	} = await getClient();

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

	const sentMailbox = await findSentMailbox(
		mailboxSpecialUseService,
		mailboxService,
		accountId,
	);
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
					const rawMessage = await renderRawMessage(buildMailMessage(outbox));

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
			//
			// The row goes first, and nothing that can fail may come before it. The
			// APPEND above has already happened; anything between it and this delete
			// that throws leaves the row for the job to retry, and the retry appends
			// a second copy to the user's Sent folder. A storage error is not worth
			// a duplicate message — the attachment objects that outlive their row
			// are exactly what the sweep collects, so losing this delete costs a
			// sweep and nothing else.
			await outboxMessageService.delete(
				account.accountConfigId,
				outboxMessageId,
			);
			await outboxAttachmentService.discardAll(
				account.accountConfigId,
				accountId,
				outboxMessageId,
			);
			log.info(
				{ outboxMessageId },
				"Deleted outbox row after successful APPEND to Sent",
			);
		},
	);
};
