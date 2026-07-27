import type { IUnitOfWork, UnitOfWorkRepositories } from "@remit/data-ports";

/**
 * Runs the write set against fixed repositories with no surrounding
 * transaction: the writes are not atomic. For a backend that has no
 * cross-entity transaction this matches its own guarantees; the SQLite path
 * injects a real transactional unit of work instead.
 */
export class PassThroughUnitOfWork implements IUnitOfWork {
	constructor(private repos: UnitOfWorkRepositories) {}

	transaction<T>(
		fn: (repos: UnitOfWorkRepositories) => Promise<T>,
	): Promise<T> {
		return fn(this.repos);
	}
}
