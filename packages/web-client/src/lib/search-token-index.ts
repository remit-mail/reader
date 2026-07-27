/**
 * Builds the name -> id indexes `parseSearchTokens` uses to resolve `in:` and
 * `account:` tokens (#428 follow-up, see doc/design/flows/06-search.md), and the
 * same names as the values the search box offers for those tokens. Pure
 * functions over already-loaded data; the caller owns fetching accounts and
 * mailboxes (`useMailboxNameIndex` fans out the mailbox-list queries).
 *
 * The offers are built from the same lists as the indexes so that every value on
 * the list resolves back to the folder or account it was built from: what the
 * box suggests and what the parser accepts cannot drift apart.
 */
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { getMailboxDisplayName } from "./folder-roles.js";
import type { SearchSuggestionValue } from "./search-suggestions.js";

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

/**
 * The folders `in:` can name, in the shortest spelling that still resolves to
 * the folder it names: the leaf where no other folder shares it, the full path
 * where one does — the same rule the index resolves by, from the other side.
 *
 * The row reads the folder's own name (a user's rename wins) and carries the
 * account it belongs to whenever more than one is loaded, because two accounts
 * with an Archive each are otherwise two identical rows.
 */
export function buildMailboxSuggestionValues(
	mailboxesByAccount: readonly RemitImapMailboxResponse[][],
	accounts: readonly RemitImapAccountResponse[] = [],
): SearchSuggestionValue[] {
	const all = mailboxesByAccount.flat().filter((mailbox) => mailbox.fullPath);
	const leafCounts = new Map<string, number>();
	for (const mailbox of all) {
		const leaf = getMailboxDisplayName(mailbox.fullPath).toLowerCase();
		leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
	}
	const emailByAccountId = new Map(
		accounts.map((account) => [account.accountId, account.email]),
	);
	return all.map((mailbox) => {
		const leaf = getMailboxDisplayName(mailbox.fullPath);
		const unique = leafCounts.get(leaf.toLowerCase()) === 1;
		const hint =
			accounts.length > 1 ? emailByAccountId.get(mailbox.accountId) : undefined;
		return {
			value: unique ? leaf : mailbox.fullPath,
			label: mailbox.displayNameOverride?.trim() || leaf,
			...(hint ? { hint } : {}),
		};
	});
}

/**
 * The accounts `account:` can name — the local part where it is unambiguous,
 * the whole address where it is not — read as the account's own name.
 */
export function buildAccountSuggestionValues(
	accounts: readonly RemitImapAccountResponse[],
): SearchSuggestionValue[] {
	const localPartCounts = new Map<string, number>();
	for (const account of accounts) {
		const localPart = account.email.toLowerCase().split("@")[0] ?? "";
		localPartCounts.set(localPart, (localPartCounts.get(localPart) ?? 0) + 1);
	}
	return accounts.map((account) => {
		const localPart = account.email.split("@")[0] ?? account.email;
		const unique = localPartCounts.get(localPart.toLowerCase()) === 1;
		const displayName = account.displayName?.trim();
		return {
			value: unique ? localPart : account.email,
			label: displayName || account.email,
			...(displayName ? { hint: account.email } : {}),
		};
	});
}
