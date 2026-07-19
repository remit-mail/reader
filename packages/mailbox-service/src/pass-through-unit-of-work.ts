import type {
	IUnitOfWork,
	UnitOfWorkRepositories,
} from "@remit/data-ports";

/**
 * Runs the write set against fixed repositories with no surrounding
 * transaction. For backends (DynamoDB) that have no cross-entity transaction:
 * the writes are not atomic, matching that backend's own guarantees. The
 * Postgres path injects a real transactional unit of work instead.
 */
export class PassThroughUnitOfWork implements IUnitOfWork {
	constructor(private repos: UnitOfWorkRepositories) {}

	transaction<T>(
		fn: (repos: UnitOfWorkRepositories) => Promise<T>,
	): Promise<T> {
		return fn(this.repos);
	}
}
