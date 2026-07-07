import type {
	AccountDescription,
	AccountItem,
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
}
