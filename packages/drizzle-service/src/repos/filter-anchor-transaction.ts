import type {
	CreateFilterAnchorInput,
	CreateFilterInput,
	FilterItem,
	IFilterAnchorTransaction,
} from "@remit/data-ports";
import type { Db } from "../db.js";
import { runInTransaction } from "../tx.js";
import { FilterRepo } from "./filter.js";
import { FilterAnchorRepo } from "./filter-anchor.js";

type DB = Db<Record<string, unknown>>;

/**
 * Runs the `Filter` create and its optional `FilterAnchor` write in one
 * transaction (#351): a failure on either side rolls back both, so a
 * `Filter` row can never persist with `hasAnchor: true` and no matching
 * `FilterAnchor` row, and a `FilterAnchor` write failure surfaces as a
 * failed create request rather than a silently-broken filter.
 */
export class DrizzleFilterAnchorTransaction
	implements IFilterAnchorTransaction
{
	constructor(private db: DB) {}

	createWithAnchor(
		filterInput: CreateFilterInput,
		anchorInput: Omit<CreateFilterAnchorInput, "filterId"> | null,
	): Promise<FilterItem> {
		return runInTransaction(this.db, async (tx) => {
			const filterRepo = new FilterRepo(tx as never);
			const filter = await filterRepo.create(filterInput);

			if (anchorInput) {
				const filterAnchorRepo = new FilterAnchorRepo(tx as never);
				await filterAnchorRepo.put({
					...anchorInput,
					filterId: filter.filterId,
				});
			}

			return filter;
		});
	}
}
