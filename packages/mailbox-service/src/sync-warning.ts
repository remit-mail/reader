import type {
	ISyncWarningRepository,
	SyncWarningItem,
	SyncWarningKey,
} from "@remit/data-ports";

export type SyncWarningContext = Omit<SyncWarningKey, "uid" | "stage">;

export type ServerUids =
	| { kind: "Listed"; uids: readonly number[] }
	| { kind: "Unlisted" };

export interface SyncWarningRound {
	failedUids: readonly number[];
	syncedUids: readonly number[];
	serverUids: ServerUids;
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

		const recorded = await this.repository.listByMailboxId(context.mailboxId);
		const synced = new Set(round.syncedUids);
		const listed =
			round.serverUids.kind === "Listed"
				? new Set(round.serverUids.uids)
				: undefined;
		const cleared = recorded
			.filter(
				(row) =>
					row.stage === stage &&
					(row.uidValidity !== context.uidValidity ||
						synced.has(row.uid) ||
						(listed !== undefined && !listed.has(row.uid))),
			)
			.map((row) => row.syncWarningId);
		await this.repository.deleteMany(cleared);
	}
}
