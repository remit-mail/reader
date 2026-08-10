import type {
	ISenderSignerStandingRepository,
	ObserveSenderSignerStandingInput,
	SenderSignerStandingItem,
} from "@remit/data-ports";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { senderSignerStandingTable } from "../schema.js";

type DB = Db<Record<string, unknown>>;

function rowToStanding(
	row: typeof senderSignerStandingTable.$inferSelect,
): SenderSignerStandingItem {
	return {
		accountConfigId: row.accountConfigId,
		senderKey: row.senderKey,
		signerDomain: row.signerDomain,
		messageCount: row.messageCount,
		firstSeenAt: row.firstSeenAt,
		lastSeenAt: row.lastSeenAt,
		userAffirmedAt: row.userAffirmedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class SenderSignerStandingRepo
	implements ISenderSignerStandingRepository
{
	constructor(private db: DB) {}

	async observe(
		input: ObserveSenderSignerStandingInput,
	): Promise<SenderSignerStandingItem> {
		const now = Date.now();
		// `first_seen_at` is deliberately absent from the conflict `set`.
		// onConflictDoUpdate writes only the columns it names, so naming it here
		// would let every message reset the key's age to its own arrival and the
		// standing this row exists to record would never be older than the last
		// message. The mirror-image mistake — a conflict path that must reset a
		// timestamp and would silently inherit the old one by omitting it — is at
		// i4-message-flag-push.ts:70.
		const [row] = await this.db
			.insert(senderSignerStandingTable)
			.values({
				accountConfigId: input.accountConfigId,
				senderKey: input.senderKey,
				signerDomain: input.signerDomain,
				messageCount: 1,
				firstSeenAt: input.observedAt,
				lastSeenAt: input.observedAt,
				userAffirmedAt: 0,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					senderSignerStandingTable.accountConfigId,
					senderSignerStandingTable.senderKey,
					senderSignerStandingTable.signerDomain,
				],
				set: {
					messageCount: sql`${senderSignerStandingTable.messageCount} + 1`,
					lastSeenAt: input.observedAt,
					updatedAt: now,
				},
			})
			.returning();
		if (!row) {
			throw new Error(
				`Failed to upsert SenderSignerStanding: ${input.accountConfigId}/${input.senderKey}/${input.signerDomain}`,
			);
		}
		return rowToStanding(row);
	}

	async get(
		accountConfigId: string,
		senderKey: string,
		signerDomain: string,
	): Promise<SenderSignerStandingItem> {
		const [row] = await this.db
			.select()
			.from(senderSignerStandingTable)
			.where(
				and(
					eq(senderSignerStandingTable.accountConfigId, accountConfigId),
					eq(senderSignerStandingTable.senderKey, senderKey),
					eq(senderSignerStandingTable.signerDomain, signerDomain),
				),
			);
		if (!row) {
			throw new NotFoundError(
				`SenderSignerStanding not found: ${senderKey}/${signerDomain}`,
			);
		}
		return rowToStanding(row);
	}
}
