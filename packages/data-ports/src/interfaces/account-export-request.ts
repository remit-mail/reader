import type {
	AccountExportRequestItem,
	CreateAccountExportRequestInput,
	ResultList,
	UpdateAccountExportRequestInput,
} from "../types.js";

export interface IAccountExportRequestRepository {
	create(
		input: CreateAccountExportRequestInput,
	): Promise<AccountExportRequestItem>;
	get(accountExportRequestId: string): Promise<AccountExportRequestItem>;
	update(
		accountExportRequestId: string,
		input: UpdateAccountExportRequestInput,
	): Promise<AccountExportRequestItem>;
	listByAccountConfig(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<AccountExportRequestItem>>;
}
