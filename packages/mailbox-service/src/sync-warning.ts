import type {
	ISyncWarningRepository,
	SyncWarningItem,
	SyncWarningKey,
} from "@remit/data-ports";

export type SyncWarningContext = Omit<SyncWarningKey, "uid" | "stage">;

export type ServerUids =
	| { kind: "Listed"; uids: readonly number[] }
	| { kind: "OnRequest"; list: () => Promise<readonly number[]> }
	| { kind: "Unlisted" };

export interface SyncWarningRound {
	failedUids: readonly number[];
	syncedUids: readonly number[];
	serverUids: ServerUids;
}

const listedUids = async (
	serverUids: ServerUids,
	recordedCount: number,
): Promise<Set<number> | undefined> => {
	if (serverUids.kind === "Listed") return new Set(serverUids.uids);
	if (serverUids.kind === "OnRequest" && recordedCount > 0) {
		return new Set(await serverUids.list());
	}
	return undefined;
};

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
		const listed = await listedUids(round.serverUids, recorded.length);
		const cleared = recorded
			.filter(
				(row) =>
					(listed !== undefined && !listed.has(row.uid)) ||
					(row.stage === stage &&
						(row.uidValidity !== context.uidValidity || synced.has(row.uid))),
			)
			.map((row) => row.syncWarningId);
		await this.repository.deleteMany(cleared);
	}
}
