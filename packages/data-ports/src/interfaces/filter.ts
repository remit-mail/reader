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
	/**
	 * Lazily patch a Temporary filter read past its `expiresAt` to `Expired` and
	 * return the refreshed row (RFC 034 Decision 1.2). `expiresAt`/`now` are the
	 * source of truth for whether a filter is still active — `state` is only a
	 * cache of that comparison, refreshed here on whatever read touches the row
	 * next. A no-op (returns the item unchanged) for a Standing filter or one
	 * already Expired.
	 */
	refreshExpiry(item: FilterItem): Promise<FilterItem>;
}
