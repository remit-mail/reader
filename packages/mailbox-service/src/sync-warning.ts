import type {
	ISyncWarningRepository,
	SyncWarningItem,
	SyncWarningKey,
} from "@remit/data-ports";
import { deriveSyncWarningId } from "@remit/data-ports/id";

export type SyncWarningContext = Omit<SyncWarningKey, "uid" | "stage">;

export interface SyncWarningRound {
	failedUids: readonly number[];
	syncedUids: readonly number[];
}

export class SyncWarningService {
	constructor(private readonly repository: ISyncWarningRepository) {}

	async settle(
		context: SyncWarningContext,
		stage: SyncWarningItem["stage"],
		round: SyncWarningRound,
	): Promise<void> {
		await this.repository.recordFailures(
			[...new Set(round.failedUids)].map((uid) => ({ ...context, uid, stage })),
		);

		if (round.syncedUids.length === 0) return;
		const recorded = await this.repository.listByMailboxId(context.mailboxId);
		if (recorded.length === 0) return;

		const recordedIds = new Set(recorded.map((row) => row.syncWarningId));
		const cleared = round.syncedUids
			.map((uid) =>
				deriveSyncWarningId(
					context.accountId,
					context.mailboxId,
					context.uidValidity,
					uid,
					stage,
				),
			)
			.filter((syncWarningId) => recordedIds.has(syncWarningId));
		await this.repository.deleteMany(cleared);
	}
}
