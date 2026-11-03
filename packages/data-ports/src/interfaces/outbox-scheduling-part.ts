import type { OutboxSchedulingPartItem } from "../types.js";

/**
 * The scheduling parts of outbox messages. A part is written with its message
 * (`IOutboxMessageRepository.create`) and removed with it, so it is only ever
 * read here.
 */
export interface IOutboxSchedulingPartRepository {
	find(outboxMessageId: string): Promise<OutboxSchedulingPartItem | null>;
	/** The parts about one event whose messages are still in the outbox. */
	listByCalendarObject(
		accountConfigId: string,
		calendarObjectId: string,
	): Promise<OutboxSchedulingPartItem[]>;
}
