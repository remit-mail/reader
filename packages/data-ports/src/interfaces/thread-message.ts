import type {
	CreateThreadMessageInput,
	ResultList,
	SearchOptions,
	ThreadMessageItem,
	UpdateThreadMessageInput,
} from "../types.js";

export interface IThreadMessageRepository {
	create(input: CreateThreadMessageInput): Promise<ThreadMessageItem>;
	get(
		accountConfigId: string,
		threadMessageId: string,
	): Promise<ThreadMessageItem>;
	get(
		accountConfigId: string,
		threadMessageIds: string[],
	): Promise<ThreadMessageItem[]>;
	update(
		accountConfigId: string,
		threadMessageId: string,
		input: UpdateThreadMessageInput,
		options?: {
			composites?: {
				sentDate?: number;
				mailboxId?: string;
				isRead?: boolean;
				isDeleted?: boolean;
				hasStars?: boolean;
				hasAttachment?: boolean;
			};
		},
	): Promise<ThreadMessageItem>;
	delete(accountConfigId: string, threadMessageId: string): Promise<void>;
	deleteMany(
		keys: Array<{ accountConfigId: string; threadMessageId: string }>,
	): Promise<void>;
	listByAccount(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<ThreadMessageItem>>;
	listByDate(
		accountConfigId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			inboxMailboxIds?: Set<string>;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>>;
	/**
	 * List starred rows for a config, newest first, across every mailbox.
	 *
	 * Backed by the `byStarred` index (pk = accountConfigId, sk = hasStars +
	 * sentDate). Starredness is read from `hasStars` — the boolean of record —
	 * never from the presentation-only `star` colour. `mailboxIds` narrows the
	 * result to a caller-supplied set (used to drop muted mailboxes and the
	 * folders a star never surfaces from); omitting it returns every mailbox.
	 *
	 * Rows are per mailbox, not per conversation: the same mail filed in two
	 * folders is two rows sharing a `threadId`. Callers that render one row per
	 * conversation must collapse by `threadId` across the pages they have
	 * accumulated — this cannot be done inside a single page.
	 */
	listByStarred(
		accountConfigId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			mailboxIds?: Set<string>;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>>;
	/**
	 * Every message of a thread, across all mailboxes of the account. A
	 * conversation spans INBOX, Sent and any folder its messages were filed
	 * in, so this listing is deliberately not scoped to a mailbox (#46).
	 */
	listByThread(
		threadId: string,
		accountConfigId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>>;
	findByMessageId(
		accountConfigId: string,
		messageId: string,
	): Promise<ThreadMessageItem | null>;
	findAllByMessageId(
		accountConfigId: string,
		messageId: string,
	): Promise<ThreadMessageItem[]>;
	getByMessageId(
		accountConfigId: string,
		messageId: string,
	): Promise<ThreadMessageItem>;
	listByMailbox(
		accountConfigId: string,
		mailboxId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			attributes?: string[];
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>>;
	countByThread(accountConfigId: string, threadId: string): Promise<number>;
	searchByMailbox(
		accountConfigId: string,
		mailboxId: string,
		search: SearchOptions,
		options?: {
			order?: "asc" | "desc";
			count?: number;
			continuationToken?: string;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>>;
	searchByMailboxWindow(
		accountConfigId: string,
		mailboxId: string,
		search: SearchOptions,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			attributes?: string[];
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>>;
	countByMailbox(
		accountConfigId: string,
		mailboxId: string,
		search: SearchOptions,
		options?: {
			limit?: number;
			excludeDeleted?: boolean;
			order?: "asc" | "desc";
		},
	): Promise<number>;
	listAllByAccount(accountConfigId: string): Promise<ThreadMessageItem[]>;
	deleteAllByAccount(accountConfigId: string): Promise<number>;
}
