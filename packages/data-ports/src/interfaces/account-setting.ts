import type {
	AccountSettingItem,
	UpsertAccountSettingInput,
} from "../types.js";

export interface IAccountSettingRepository {
	get(
		accountConfigId: string,
		name: string,
	): Promise<AccountSettingItem | null>;
	listByAccountConfig(accountConfigId: string): Promise<AccountSettingItem[]>;
	upsert(input: UpsertAccountSettingInput): Promise<AccountSettingItem>;
	delete(accountConfigId: string, name: string): Promise<void>;
}
