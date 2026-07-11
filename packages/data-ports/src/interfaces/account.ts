import type {
	AccountDescription,
	AccountItem,
	AccountSchedulerPage,
	CreateAccountInput,
	ResultList,
	UpdateAccountInput,
} from "../types.js";

export interface IAccountRepository {
	create(input: CreateAccountInput): Promise<AccountItem>;
	get(accountId: string): Promise<AccountItem>;
	get(accountIds: string[]): Promise<AccountItem[]>;
	update(
		accountId: string,
		input: UpdateAccountInput,
		remove?: string[],
	): Promise<AccountItem>;
	markAuthenticated(accountId: string): Promise<AccountItem>;
	delete(accountId: string): Promise<void>;
	deleteMany(accountIds: string[]): Promise<void>;
	list(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<AccountItem>>;
	listAllByAccountConfig(accountConfigId: string): Promise<AccountItem[]>;
	describe(accountId: string): Promise<AccountDescription>;
	listAll(): Promise<AccountItem[]>;
	incrementMailboxSynced(accountId: string): Promise<AccountItem>;
	/**
	 * Page through every account system-wide, oldest-created first, for the
	 * scheduled-sync tick (#1247). Unlike `list()` this is not accountConfig
	 * scoped and the cursor is a raw backend-native token (no salt/tamper
	 * checking) — internal use only, never exposed over the API.
	 */
	listAllAccountsPage(options?: {
		limit?: number;
		cursor?: string;
	}): Promise<AccountSchedulerPage>;
}
