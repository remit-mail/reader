import type {
	CreateFilterInput,
	FilterItem,
	UpdateFilterInput,
} from "../types.js";

export interface IFilterRepository {
	create(input: CreateFilterInput): Promise<FilterItem>;
	get(accountConfigId: string, filterId: string): Promise<FilterItem>;
	update(
		accountConfigId: string,
		filterId: string,
		input: UpdateFilterInput,
	): Promise<FilterItem>;
	delete(accountConfigId: string, filterId: string): Promise<void>;
	listByAccountConfig(accountConfigId: string): Promise<FilterItem[]>;
	listByAccountAndState(
		accountConfigId: string,
		state: FilterItem["state"],
	): Promise<FilterItem[]>;
}
