import { getClient } from "@remit/backend/client";
import { OutboxMessageStatus } from "@remit/domain-enums";
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

const UNFILED_NO_SENT_MAILBOX =
	"Sent, but not filed: this account has no folder appointed to the Sent role and none that a Sent folder could be recognised by. Appoint one in the account's folder settings and later messages will be filed there.";

const UNFILED_SIGNED_OUT =
	"Sent, but not filed: this account has to be signed in again before a copy can be stored in Sent.";

const unfiledAppendRefused = (fullPath: string, error: unknown): string =>
	`Sent, but not filed: the mail server refused to store a copy in ${fullPath} (${error instanceof Error ? error.message : String(error)}).`;

/**
 * Fallback when `APPEND_SENT_MAX_ATTEMPTS` is unset (local dev, unit tests).
 * Matches the shared `MAX_RECEIVE_COUNT` every queue's redrive policy uses,
 * same pattern as `FLAG_PUSH_MAX_ATTEMPTS` / `BODY_SYNC_MAX_ATTEMPTS`.
 */
const DEFAULT_APPEND_SENT_MAX_ATTEMPTS = 3;

export const getAppendSentMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.APPEND_SENT_MAX_ATTEMPTS;
	if (!raw) return DEFAULT_APPEND_SENT_MAX_ATTEMPTS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_APPEND_SENT_MAX_ATTEMPTS;
};

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

	const outbox = await outboxMessageService.get(
		account.accountConfigId,
		outboxMessageId,
	);
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

	const sentMailbox = await mailboxSpecialUseService.findSentMailbox(accountId);
	if (!sentMailbox) {
		await settleUnfiled(UNFILED_NO_SENT_MAILBOX);
		return;
	}

	let appended = false;

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

					appended = true;
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
	).then(
		() => null,
		(error: unknown) => {
			// Below the redrive budget this is an ordinary retry — connections
			// drop, servers go away, and the row is still `sent` for the next
			// attempt to pick up. At the budget the record would dead-letter, and a
			// dead-lettered APPEND is exactly how a delivered message goes missing.
			//
			// The budget binds whether or not the APPEND landed. A redelivery
			// starts from the top and appends again, so an unbudgeted retry files
			// one copy per attempt in the user's Sent folder.
			if (receiveCount < APPEND_SENT_MAX_ATTEMPTS) throw error;
			return error;
		},
	);

	// The APPEND landed: the copy is in Sent whatever failed after it, so there
	// is nothing to settle as unfiled. A row that outlives its delete holds
	// `sent`, which every view hides, until the migrator's boot-time stranded-row
	// repair settles it — the next container start, not sooner (#824).
	if (appended) {
		if (failure) {
			log.error(
				{ accountId, outboxMessageId, reason: String(failure) },
				"Sent message was filed but its outbox row survived its delete and stays hidden until the boot-time repair",
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
