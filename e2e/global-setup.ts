/**
 * Walks the deployment's whole first-run path once, so every spec starts from a
 * real user with a real account and real mail on a real IMAP server. Nothing is
 * seeded: each step here is an HTTP or IMAP call any client could make.
 */
import { writeFileSync } from "node:fs";
import { ApiClient, fetchBearerToken, signUp, waitFor } from "./src/api.js";
import { baseUrl, imap, imapFromStack, mintImapUser } from "./src/env.js";
import { appendMessages, listServerSubjects } from "./src/imap.js";
import {
	ensureStateDir,
	storageStatePath,
	writeRunState,
} from "./src/state.js";

const SEEDED_SUBJECTS = [
	"Quarterly numbers are in",
	"Lunch on Thursday?",
	"Your receipt from the hardware store",
];

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
	await appendMessages(
		imapUser,
		SEEDED_SUBJECTS.map((subject) => ({ subject })),
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
		seededSubjects: SEEDED_SUBJECTS,
	});
	console.log(
		`e2e setup: ready (mailbox ${imapUser}, account ${accountId}, inbox ${inbox.mailboxId})`,
	);
};

export default globalSetup;
