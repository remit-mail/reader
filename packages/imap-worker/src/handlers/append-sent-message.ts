import { getClient } from "@remit/backend/client";
import {
	APPENDED_UID_NONE,
	APPENDED_UID_UNREPORTED,
	isSentCopyFiled,
} from "@remit/data-ports";
import { OutboxMessageStatus } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import {
	buildMailMessage,
	renderRawMessage,
} from "@remit/smtp-service/message-builder";
import { attemptBudget } from "@remit/sqs-client/attempt-budget";
import { isAccountDeleted } from "../account-check.js";
import { createConnectionScopeWithCredentials } from "../connection-scope.js";
import type { AppendSentMessageEvent } from "../events.js";
import { isNotFoundError } from "../is-not-found.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";

const UNFILED_NO_SENT_MAILBOX =
	"Sent, but not filed: this account has no folder appointed to the Sent role and none that a Sent folder could be recognised by. Appoint one in the account's folder settings and later messages will be filed there.";

const UNFILED_SIGNED_OUT =
	"Sent, but not filed: this account has to be signed in again before a copy can be stored in Sent.";

const ROW_SURVIVED_ITS_DELETE =
	"Sent message was filed but its outbox row survived its delete and stays hidden until the boot-time repair";

const unfiledAppendRefused = (fullPath: string, error: unknown): string =>
	`Sent, but not filed: the mail server refused to store a copy in ${fullPath} (${error instanceof Error ? error.message : String(error)}).`;

export const getAppendSentMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => attemptBudget("APPEND_SENT_MAX_ATTEMPTS", 3, processEnv);

export const APPEND_SENT_MAX_ATTEMPTS = getAppendSentMaxAttempts();

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
	/**
	 * SQS's own delivery count for this record. The APPEND is the last step of a
	 * message the user has already had delivered, so exhausting the redrive
	 * budget must settle the row rather than dead-letter it: a DLQ'd record
	 * leaves the row at `sent`, which no view shows.
	 */
	receiveCount = 1,
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
		secrets,
	} = await getClient();

	const { accountId, outboxMessageId } = event;

	log.info({ event: event.type, accountId, outboxMessageId }, "Handling event");

	const account = await accountService.get(accountId);
	if (isAccountDeleted(account, log)) {
		return;
	}

	// A row this event names can be gone by the time the event is redelivered:
	// its own last attempt deleted it, or the boot repair dropped it on the
	// strength of a recorded uid. Either way the work is done, and re-throwing
	// the same NotFoundError on every redelivery only dead-letters it.
	const outbox = await outboxMessageService
		.get(account.accountConfigId, outboxMessageId)
		.catch((error: unknown) => {
			if (isNotFoundError(error)) return null;
			throw error;
		});
	if (!outbox) {
		log.warn(
			{ accountId, outboxMessageId },
			"Skipping APPEND_SENT_MESSAGE: the outbox row is already gone",
		);
		return;
	}
	if (outbox.status !== OutboxMessageStatus.sent) {
		log.info(
			{ outboxMessageId, status: outbox.status },
			"Outbox message not in sent status, skipping APPEND",
		);
		return;
	}

	// The message left over SMTP; only the filing can still fail. Settling the
	// row as `unfiled` keeps it in the Outbox list rather than deleting it, so a
	// delivered message stays readable somewhere. Every path out of this handler
	// that is not a confirmed APPEND ends here.
	const settleUnfiled = async (reason: string): Promise<void> => {
		log.error(
			{ accountId, outboxMessageId, reason },
			"Sent message could not be filed, settling the outbox row as unfiled",
		);
		await outboxMessageService.update(
			account.accountConfigId,
			outboxMessageId,
			{
				status: OutboxMessageStatus.unfiled,
				lastError: reason,
			},
		);
	};

	// The copy is in Sent, so the row is a leftover and deleting it is all that
	// is left to do. Both steps are idempotent against a row that is already
	// gone, so nothing here needs to know how far the last attempt got.
	//
	// Files first, row second, the same order outbox-queue.ts discards a draft
	// in. Nothing but this row points at those objects: a row that outlives its
	// files is hidden and the boot repair drops it, while files that outlive
	// their row name a message nothing can reach and are vouched for forever.
	const dropOutboxRow = async (): Promise<void> => {
		await outboxAttachmentService.discardAll(
			account.accountConfigId,
			accountId,
			outboxMessageId,
		);
		await outboxMessageService.delete(account.accountConfigId, outboxMessageId);
		log.info(
			{ outboxMessageId },
			"Deleted outbox row after successful APPEND to Sent",
		);
	};

	// Everything this recovers from happened after the copy reached Sent, so
	// re-appending is off the table and the delete is the only step left to
	// retry. Below the redrive budget that retry is worth having; at it the
	// record would dead-letter, so the row is left at `sent` for the repair.
	const retryDropWithinBudget = (error: unknown): void => {
		if (receiveCount < APPEND_SENT_MAX_ATTEMPTS) throw error;
		log.error({ accountId, outboxMessageId, error }, ROW_SURVIVED_ITS_DELETE);
	};

	// A redelivery of an event whose APPEND already landed. The copy is in the
	// user's Sent folder and the only step still owed is the delete that failed
	// last time; starting from the top would file a second copy of a message the
	// user sent once (#858). Ahead of the Sent-mailbox lookup on purpose — a
	// message that is already filed does not need one, and an account that lost
	// its Sent appointment in between must not settle as unfiled.
	if (isSentCopyFiled(outbox)) {
		log.info(
			{ outboxMessageId, appendedUid: outbox.appendedUid },
			"Sent copy was already filed by an earlier attempt, skipping the APPEND",
		);
		await dropOutboxRow().catch(retryDropWithinBudget);
		return;
	}

	const sentMailbox = await mailboxSpecialUseService.findSentMailbox(accountId);
	if (!sentMailbox) {
		await settleUnfiled(UNFILED_NO_SENT_MAILBOX);
		return;
	}

	let appendedUid = APPENDED_UID_NONE;

	const failure = await withOAuthLifecycle(
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

					// A server without UIDPLUS files the copy and names no uid for
					// it, which is still a filed copy and has to read as one.
					appendedUid = result.uid > 0 ? result.uid : APPENDED_UID_UNREPORTED;
				})
				.finally(() => scope.disconnect());

			// The idempotency key, and the only reason a redelivery is safe. It is
			// written before the delete and never after it: from here on every step
			// can fail and be retried without the user gaining a second copy, and
			// the one window that still can is this single row update.
			await outboxMessageService.update(
				account.accountConfigId,
				outboxMessageId,
				{ appendedUid },
			);

			// The message now lives in the IMAP Sent folder. Drop the outbox row so
			// the user does not see it twice in the UI (Outbox + Sent). Issue #178.
			await dropOutboxRow();
		},
	).then(
		() => null,
		(error: unknown) => {
			// Below the redrive budget this is an ordinary retry — connections
			// drop, servers go away, and the row is still `sent` for the next
			// attempt to pick up. At the budget the record would dead-letter, and a
			// dead-lettered APPEND is exactly how a delivered message goes missing.
			//
			// The budget still binds after a landed APPEND, though no longer to
			// hold off a duplicate: the recorded uid does that, and the retries
			// the budget allows re-drive the delete alone.
			if (receiveCount < APPEND_SENT_MAX_ATTEMPTS) throw error;
			return error;
		},
	);

	// The APPEND landed: the copy is in Sent whatever failed after it, so there
	// is nothing to settle as unfiled. A row that outlives its delete holds
	// `sent`, which every view hides, until the migrator's boot-time stranded-row
	// repair drops it — the next container start, not sooner (#824).
	if (isSentCopyFiled({ appendedUid })) {
		if (failure) {
			log.error(
				{ accountId, outboxMessageId, reason: String(failure) },
				ROW_SURVIVED_ITS_DELETE,
			);
		}
		return;
	}

	// A terminal auth failure returns here without throwing — withOAuthLifecycle
	// flips the account to reauth_required and ACKs the record, which without
	// this would leave the row at `sent` and the message nowhere.
	await settleUnfiled(
		failure
			? unfiledAppendRefused(sentMailbox.fullPath, failure)
			: UNFILED_SIGNED_OUT,
	);
};
