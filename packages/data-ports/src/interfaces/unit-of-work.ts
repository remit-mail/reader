import type { IAddressRepository } from "./address.js";
import type { IEnvelopeRepository } from "./envelope.js";
import type { IMessageRepository } from "./message.js";
import type { IThreadMessageRepository } from "./thread-message.js";

/**
 * The repositories a `saveMessage` write set touches, bound to a single unit of
 * work. On Postgres these are transaction-bound so every write — including the
 * transactional-outbox rows the message write appends — commits or rolls back
 * together.
 */
export interface UnitOfWorkRepositories {
	message: IMessageRepository;
	envelope: IEnvelopeRepository;
	address: IAddressRepository;
	threadMessage: IThreadMessageRepository;
}

/**
 * Runs a set of related writes as one atomic unit. The callback receives
 * repositories bound to the unit of work; a throw rolls the whole set back.
 *
 * Backends without cross-entity transactions supply a pass-through
 * implementation that runs the callback against the plain repositories.
 */
export interface IUnitOfWork {
	transaction<T>(fn: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T>;
}
