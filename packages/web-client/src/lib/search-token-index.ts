/**
 * Builds the name -> id indexes `parseSearchTokens` uses to resolve `in:` and
 * `account:` tokens (#428 follow-up, see doc/design/flows/06-search.md). Pure
 * functions over already-loaded data; the caller owns fetching accounts and
 * mailboxes (`useMailboxNameIndex` fans out the mailbox-list queries).
 */
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";

/**
 * Account email (and its local-part before `@`) -> accountId, lower-cased.
 * `account:work` matches an account whose email starts with `work@`, mirroring
 * the label the nav sidebar and daily brief account chips already show
 * (`account.email.split("@")[0]`). The first account wins a collision.
 */
export function buildAccountNameIndex(
	accounts: RemitImapAccountResponse[],
): Map<string, string> {
	const index = new Map<string, string>();
	for (const account of accounts) {
		const email = account.email.toLowerCase();
		const localPart = email.split("@")[0];
		if (localPart && !index.has(localPart)) {
			index.set(localPart, account.accountId);
		}
		if (!index.has(email)) index.set(email, account.accountId);
	}
	return index;
}

/**
 * Mailbox full path (and its last path segment) -> mailboxId, lower-cased, so
 * `in:archive` matches a mailbox at `INBOX/Archive` as well as one literally
 * named `Archive`. Takes one mailbox list per account (as returned by the
 * per-account mailbox-list fan-out) and merges them into one index; the first
 * mailbox wins a name collision across accounts.
 */
export function buildMailboxNameIndex(
	mailboxesByAccount: RemitImapMailboxResponse[][],
): Map<string, string> {
	const index = new Map<string, string>();
	for (const mailboxes of mailboxesByAccount) {
		for (const mailbox of mailboxes) {
			const fullPath = mailbox.fullPath?.toLowerCase();
			if (!fullPath) continue;
			const lastSegment = fullPath.split("/").pop();
			if (!index.has(fullPath)) index.set(fullPath, mailbox.mailboxId);
			if (lastSegment && !index.has(lastSegment)) {
				index.set(lastSegment, mailbox.mailboxId);
			}
		}
	}
	return index;
}
