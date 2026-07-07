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
	listByThread(
		threadId: string,
		accountConfigId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			mailboxId?: string;
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
