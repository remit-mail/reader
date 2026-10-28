export type { ConnectionScope } from "@remit/mailbox-service";
export {
	type BorrowedConnection,
	type ConnectImap,
	type ConnectionPool,
	type ConnectionPoolOptions,
	createConnectionPool,
	type PoolAccount,
	type PoolOverflow,
} from "./connection-pool.js";
export {
	type AccountObjectPage,
	type AccountObjectStore,
	type AttemptBudgets,
	DEFAULT_MAILBOX_FRESHNESS_MS,
	defaultImapWorkerConfig,
	type ImapFailureKind,
	type ImapWorkerConfig,
	type ImapWorkerQueueName,
	type ProcessContext,
	type TokenService,
	type WorkerMetrics,
} from "./context.js";
export type { ImapEvent, WorkerEvent } from "./events.js";
export {
	AccountNeedsReconnectError,
	lifecycleConnectionScope,
	type OpenConnection,
} from "./lifecycle-connection-scope.js";
export { processEvent } from "./processor.js";
export type { WorkerQueues } from "./queues.js";
