import type {
	AccountConfigDescription,
	AccountConfigItem,
	CreateAccountConfigInput,
	ResultList,
	UpdateAccountConfigInput,
} from "../types.js";

export interface IAccountConfigRepository {
	create(input: CreateAccountConfigInput): Promise<AccountConfigItem>;
	get(accountConfigId: string): Promise<AccountConfigItem>;
	get(accountConfigIds: string[]): Promise<AccountConfigItem[]>;
	update(
		accountConfigId: string,
		input: UpdateAccountConfigInput,
	): Promise<AccountConfigItem>;
	delete(accountConfigId: string): Promise<void>;
	deleteMany(accountConfigIds: string[]): Promise<void>;
	listByUser(
		userId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<AccountConfigItem>>;
	describe(accountConfigId: string): Promise<AccountConfigDescription>;
	listAll(): Promise<AccountConfigItem[]>;
}
