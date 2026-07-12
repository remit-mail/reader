import type { CreateFilterAnchorInput, FilterAnchorItem } from "../types.js";

export interface IFilterAnchorRepository {
	put(input: CreateFilterAnchorInput): Promise<FilterAnchorItem>;
	get(
		accountConfigId: string,
		filterId: string,
	): Promise<FilterAnchorItem | null>;
	listByAccountConfig(accountConfigId: string): Promise<FilterAnchorItem[]>;
	delete(accountConfigId: string, filterId: string): Promise<void>;
}
