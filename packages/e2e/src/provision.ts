/**
 * Stand up a throwaway user with one IMAP account, isolated from the shared
 * onboarded run.
 *
 * A spec that deletes a folder which has held mail leaves stale message events
 * behind — they reference a mailbox that no longer exists — and those park the
 * account's message queue. That is contained to the account it happened on, so a
 * folder-churning spec runs against its own user here. A separate user, not just
 * a second account on the shared user: the API has no per-account delete, so a
 * second account would linger in the shared user's account list and change every
 * per-account screen other specs read. A separate user's accounts never appear
 * there. The account rides the same Dovecot (any username with the shared
 * password gets its own empty maildir), so no fixture server is involved.
 */
import { ApiClient, fetchBearerToken, signUp, waitFor } from "./api.js";
import { imap, imapFromStack, mintImapUser } from "./env.js";
import { appendMessages, type Message } from "./imap.js";

interface StorageStateCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Lax";
}

export interface StorageState {
	cookies: StorageStateCookie[];
	origins: never[];
}

export interface IsolatedRun {
	email: string;
	password: string;
	token: string;
	accountId: string;
	imapUser: string;
	inboxId: string;
	/** Auth for a browser context driven as this user (`browser.newContext({ storageState })`). */
	storageState: StorageState;
}

const cookiesToStorageState = (cookie: string): StorageState => ({
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

/**
 * @param seed Mail put in the mailbox before the account is connected. Mail
 * appended after onboarding does not reliably reach the classification path on
 * a triggered sync, so a spec whose subject is the category of its fixtures has
 * to seed here or it measures that instead.
 */
export const provisionIsolatedRun = async (
	label: string,
	seed: Message[] = [],
): Promise<IsolatedRun> => {
	const credentials = {
		email: `e2e-iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@remit.test`,
		password: "e2e-password-1234",
		name: label,
	};
	const cookie = await signUp(credentials);
	const token = await fetchBearerToken(cookie);
	const api = new ApiClient({ ...credentials, token });

	const imapUser = mintImapUser();
	if (seed.length > 0) await appendMessages(imapUser, seed);
	const { accountId } = await api.createAccount({
		email: imapUser,
		displayName: label,
		username: imapUser,
		password: imap.password,
		imapHost: imapFromStack.host,
		imapPort: imapFromStack.port,
		imapTls: false,
		imapStartTls: false,
	});
	await api.triggerSync(accountId);
	const boxes = await waitFor(
		() => api.listMailboxes(accountId),
		(list) => list.some((box) => box.fullPath === "INBOX"),
		{ timeoutMs: 90_000, what: "the isolated account's INBOX to sync" },
	);
	const inbox = boxes.find((box) => box.fullPath === "INBOX");
	if (!inbox) throw new Error("unreachable: INBOX matched but not found");

	return {
		email: credentials.email,
		password: credentials.password,
		token,
		accountId,
		imapUser,
		inboxId: inbox.mailboxId,
		storageState: cookiesToStorageState(cookie),
	};
};
