import type {
	IUnitOfWork,
	UnitOfWorkRepositories,
} from "@remit/data-ports";
import type { Db } from "../db.js";
import type { MessageDataSchema } from "../schema/message-data.js";
import { runInTransaction } from "../tx.js";
import { DrizzleEnvelopeRepository } from "./envelope.js";
import { AddressRepo } from "./i4-address.js";
import { DrizzleMessageRepository } from "./message.js";
import { DrizzleThreadMessageRepository } from "./thread-message.js";

/**
 * Runs a write set inside a single Postgres transaction. The repositories handed
 * to the callback are bound to that transaction, so the data rows and the
 * transactional-outbox rows the message write appends commit atomically — a
 * throw anywhere rolls the whole set back, outbox included.
 */
export class DrizzleUnitOfWork implements IUnitOfWork {
	constructor(private db: Db<MessageDataSchema>) {}

	transaction<T>(
		fn: (repos: UnitOfWorkRepositories) => Promise<T>,
	): Promise<T> {
		return runInTransaction(this.db, (tx) =>
			fn({
				message: new DrizzleMessageRepository(tx),
				envelope: new DrizzleEnvelopeRepository(tx),
				address: new AddressRepo(tx),
				threadMessage: new DrizzleThreadMessageRepository(tx),
			}),
		);
	}
}
