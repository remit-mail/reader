import type {
	IOutboxSchedulingPartRepository,
	OutboxSchedulingPartItem,
} from "@remit/data-ports";
import { and, asc, eq } from "drizzle-orm";
import type { RepositoryDb } from "../db.js";
import { outboxMessageTable } from "../schema/i4-outbox-message.js";
import { outboxSchedulingPartTable } from "../schema.js";

type DB = RepositoryDb;

const rowToPart = (
	row: typeof outboxSchedulingPartTable.$inferSelect,
): OutboxSchedulingPartItem => ({
	outboxMessageId: row.outboxMessageId,
	accountConfigId: row.accountConfigId,
	calendarObjectId: row.calendarObjectId,
	recipient: row.recipient,
	method: row.method,
	sequence: row.sequence,
	icalData: row.icalData,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

export class OutboxSchedulingPartRepo
	implements IOutboxSchedulingPartRepository
{
	constructor(private db: DB) {}

	async find(
		outboxMessageId: string,
	): Promise<OutboxSchedulingPartItem | null> {
		const [row] = await this.db
			.select()
			.from(outboxSchedulingPartTable)
			.where(eq(outboxSchedulingPartTable.outboxMessageId, outboxMessageId));
		return row ? rowToPart(row) : null;
	}

	/**
	 * Joined to the outbox so a part whose message left the outbox by a path
	 * that did not take the part with it is never reported as still in flight.
	 */
	async listByCalendarObject(
		accountConfigId: string,
		calendarObjectId: string,
	): Promise<OutboxSchedulingPartItem[]> {
		const rows = await this.db
			.select({ part: outboxSchedulingPartTable })
			.from(outboxSchedulingPartTable)
			.innerJoin(
				outboxMessageTable,
				eq(
					outboxMessageTable.outboxMessageId,
					outboxSchedulingPartTable.outboxMessageId,
				),
			)
			.where(
				and(
					eq(outboxSchedulingPartTable.accountConfigId, accountConfigId),
					eq(outboxSchedulingPartTable.calendarObjectId, calendarObjectId),
				),
			)
			.orderBy(asc(outboxSchedulingPartTable.createdAt));
		return rows.map(({ part }) => rowToPart(part));
	}
}
