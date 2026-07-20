/**
 * Walks the deployment's whole first-run path once, so every spec starts from a
 * real user with a real account and real mail on a real IMAP server. Nothing is
 * seeded: each step here is an HTTP or IMAP call any client could make.
 */
import { writeFileSync } from "node:fs";
import { ApiClient, fetchBearerToken, signUp, waitFor } from "./src/api.js";
import { buildClassificationFixtures } from "./src/classification-fixtures.js";
import { baseUrl, imap, imapFromStack, mintImapUser } from "./src/env.js";
import type { Message } from "./src/imap.js";
import { appendMessages, listServerSubjects } from "./src/imap.js";
import {
	ensureStateDir,
	storageStatePath,
	writeRunState,
} from "./src/state.js";

/**
 * Carries `\Flagged` from the moment it lands on the server, before the account
 * that will sync it exists. Seeded here rather than in a spec because the state
 * under test is what the FIRST sync makes of a pre-flagged message — once the
 * message has synced unflagged, that path cannot be replayed.
 */
const PRE_FLAGGED_SUBJECT = "Flagged before you ever saw it";

const SEEDED_MESSAGES: Message[] = [
	{ subject: "Quarterly numbers are in" },
	{ subject: "Lunch on Thursday?" },
	{ subject: "Your receipt from the hardware store" },
	{ subject: PRE_FLAGGED_SUBJECT, flags: ["\\Flagged"] },
];

const SEEDED_SUBJECTS = SEEDED_MESSAGES.map((message) => message.subject);

/**
 * A starred message filed somewhere other than INBOX. The starred view used to
 * be the newest inbox page filtered in the browser, which structurally could
 * not show this — the same case as a star past the end of that page, at the
 * cost of one APPEND instead of fifty.
 *
 * Sent rather than Junk or Trash: those two are excluded from the starred scope
 * on purpose, so a star there proves nothing about the window.
 */
const STARRED_ELSEWHERE_SUBJECT = "Filed away, and starred";

/**
 * The conversation that spans two folders. The correspondent's message lands in
 * INBOX; the user's reply to it sits in Sent, where a real client would have
 * filed it after sending. The two are chained by In-Reply-To and References, so
 * a reader that threads by the RFC 5322 headers has everything it needs to show
 * them as one conversation.
 *
 * The received subject joins `seededSubjects` because it is a fourth INBOX
 * message, and the specs that assert an exact inbox count have to keep counting
 * what is actually there. The reply is not in INBOX and so is not listed.
 */
const CONVERSATION = {
	receivedSubject: "Databricks contract renewal",
	receivedFromName: "Dana Whitfield",
	receivedFrom: "Dana Whitfield <dana@remit.test>",
	sentSubject: "Re: Databricks contract renewal",
	sentFromName: "Robin Vance",
	replyTo: "dana@remit.test",
};

/**
 * One message in Junk, from a sender who has a display name — the ordinary
 * shape, and the one the address lookup used to miss. The spam-rescue spec
 * works from this.
 *
 * Junk, not INBOX, so it stays out of `seededSubjects` and the exact-count
 * inbox assertions keep counting only what is in the inbox.
 */
const SPAM_SEED = {
	subject: "Reminder: please verify your account",
	senderName: "npm support",
	senderEmail: "support@npmjs.com",
};

const cookiesToStorageState = (cookie: string): string =>
	JSON.stringify({
		cookies: cookie.split("; ").map((pair) => {
			const separator = pair.indexOf("=");
			return {
				name: pair.slice(0, separator),
				value: pair.slice(separator + 1),
				domain: "localhost",
				path: "/",
				expires: -1,
				httpOnly: true,
				secure: false,
				sameSite: "Lax" as const,
			};
		}),
		origins: [],
	});

const globalSetup = async (): Promise<void> => {
	ensureStateDir();

	// A fresh identity and a fresh mailbox per run. The mailbox is the one that
	// matters: reusing a stack must not let a previous run's mail stand in for
	// this run's, which would turn every assertion about seeded mail into one
	// that cannot fail.
	const credentials = {
		email: `e2e-${Date.now()}@remit.test`,
		password: "e2e-password-1234",
		name: "E2E User",
	};
	const imapUser = mintImapUser();

	console.log(`e2e setup: signing up ${credentials.email} at ${baseUrl}`);
	const cookie = await signUp(credentials);
	const token = await fetchBearerToken(cookie);
	const api = new ApiClient(token);

	// Checked, not assumed. If this mailbox ever came back non-empty the
	// isolation this suite depends on would be gone, and every downstream
	// assertion would be worth less than it looks.
	console.log(`e2e setup: claiming the mailbox ${imapUser}`);
	const existing = await listServerSubjects(imapUser);
	if (existing.length > 0) {
		throw new Error(
			`${imapUser} was expected to be a fresh mailbox but holds ${existing.length} messages`,
		);
	}

	console.log("e2e setup: appending seed messages over IMAP");
	await appendMessages(imapUser, SEEDED_MESSAGES);
	await appendMessages(
		imapUser,
		[
			{
				subject: SPAM_SEED.subject,
				from: `${SPAM_SEED.senderName} <${SPAM_SEED.senderEmail}>`,
				body: "This one does not belong in Spam.",
			},
		],
		"Junk",
	);

	// The cross-folder conversation. Message-IDs are minted per run so a reused
	// stack cannot let one run's thread satisfy another's assertions, and the
	// reply is dated after the message it answers so the conversation has an
	// order to get right.
	console.log("e2e setup: appending the cross-folder conversation over IMAP");
	const receivedMessageId = `<renewal-${Date.now()}@remit.test>`;
	const receivedAt = new Date();
	await appendMessages(imapUser, [
		{
			subject: CONVERSATION.receivedSubject,
			from: CONVERSATION.receivedFrom,
			to: imapUser,
			messageIdHeader: receivedMessageId,
			date: receivedAt,
		},
	]);
	await appendMessages(
		imapUser,
		[
			{
				subject: CONVERSATION.sentSubject,
				from: `${CONVERSATION.sentFromName} <${imapUser}>`,
				to: CONVERSATION.replyTo,
				messageIdHeader: `<renewal-reply-${Date.now()}@remit.test>`,
				inReplyTo: receivedMessageId,
				references: [receivedMessageId],
				date: new Date(receivedAt.getTime() + 60_000),
			},
		],
		"Sent",
	);

	// Classification fixtures ride the same pre-onboarding append: they have to
	// be on the server before the account is connected to reach the API at all.
	const classificationFixtures = buildClassificationFixtures();
	console.log("e2e setup: appending classification fixtures over IMAP");
	await appendMessages(
		imapUser,
		classificationFixtures.map((fixture) => fixture.message),
	);

	// Starred, and filed outside INBOX. Pre-onboarding like the rest so the
	// starred listing is asserted against mail that went through a first sync,
	// not against a mid-run append.
	console.log("e2e setup: appending the starred message filed in Sent");
	await appendMessages(
		imapUser,
		[
			{
				subject: STARRED_ELSEWHERE_SUBJECT,
				body: "Starred, and not in the inbox.",
				flags: ["\\Flagged"],
			},
		],
		"Sent",
	);

	console.log("e2e setup: creating the account against dovecot");
	const { accountId } = await api.createAccount({
		email: imapUser,
		displayName: "E2E Mailbox",
		username: imapUser,
		password: imap.password,
		imapHost: imapFromStack.host,
		imapPort: imapFromStack.port,
		imapTls: false,
		imapStartTls: false,
	});

	console.log("e2e setup: triggering sync");
	await api.triggerSync(accountId);

	const mailboxes = await waitFor(
		() => api.listMailboxes(accountId),
		(list) => list.some((mailbox) => mailbox.fullPath === "INBOX"),
		{ timeoutMs: 90_000, what: "the INBOX to appear after sync" },
	);
	const inbox = mailboxes.find((mailbox) => mailbox.fullPath === "INBOX");
	if (!inbox) throw new Error("unreachable: INBOX was matched but not found");

	writeFileSync(storageStatePath, cookiesToStorageState(cookie));
	writeRunState({
		...credentials,
		token,
		accountId,
		inboxId: inbox.mailboxId,
		imapUser,
		// Everything this run appended to the INBOX, in one list. Specs that
		// assert the inbox holds EXACTLY what was seeded read this, so a fixture
		// added for one spec must appear here or it reads as an unexplained
		// extra message. Three seeded messages are deliberately absent: the
		// conversation's reply (appended to Sent), the spam fixture (appended to
		// Junk), and the starred message filed in Sent — none is in the inbox.
		// The pre-flagged message IS listed: it is inbox mail that happens to
		// carry \Flagged.
		seededSubjects: [
			...SEEDED_SUBJECTS,
			CONVERSATION.receivedSubject,
			...classificationFixtures.map((fixture) => fixture.subject),
		],
		conversation: {
			receivedSubject: CONVERSATION.receivedSubject,
			receivedFromName: CONVERSATION.receivedFromName,
			sentSubject: CONVERSATION.sentSubject,
			sentFromName: CONVERSATION.sentFromName,
		},
		classificationExpectations: classificationFixtures.map((fixture) => ({
			subject: fixture.subject,
			expectedCategory: fixture.expectedCategory,
		})),
		spamSubject: SPAM_SEED.subject,
		spamSenderName: SPAM_SEED.senderName,
		spamSenderEmail: SPAM_SEED.senderEmail,
		preFlaggedSubject: PRE_FLAGGED_SUBJECT,
		starredElsewhereSubject: STARRED_ELSEWHERE_SUBJECT,
	});
	console.log(
		`e2e setup: ready (mailbox ${imapUser}, account ${accountId}, inbox ${inbox.mailboxId})`,
	);
};

export default globalSetup;
