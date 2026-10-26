import type { RemitClient } from "@remit/backend/client";
import { SYNC_WARNING_SURFACE_ATTEMPTS } from "@remit/data-ports/sync-warning-state";
import type { Logger } from "@remit/logger";
import type { MailOAuthService } from "@remit/mail-oauth-service";
import type { ConnectionPool } from "./connection-pool.js";
import type { WorkerQueues } from "./queues.js";

export type ImapWorkerQueueName = "sync";

export type TokenService = Pick<MailOAuthService, "getAccessToken">;

export type ImapFailureKind = "auth" | "network" | "other";

export interface WorkerMetrics {
	imapFailure: (
		operation: string,
		kind: ImapFailureKind,
		count: number,
	) => void;
}

export interface BodySyncGate {
	isEnabled: (log: Logger) => Promise<boolean>;
}

export interface AccountObjectPage {
	keys: string[];
	nextContinuationToken: string | undefined;
}

export interface AccountObjectStore {
	list: (
		prefix: string,
		continuationToken: string | undefined,
	) => Promise<AccountObjectPage>;
	delete: (keys: string[]) => Promise<void>;
}

export interface AttemptBudgets {
	readonly body: number;
	readonly placementMove: number;
	readonly flagPush: number;
	readonly appendSent: number;
	readonly messageMove: number;
	readonly messageDelete: number;
	readonly messageCopy: number;
}

export interface ImapWorkerConfig {
	readonly attempts: AttemptBudgets;
	readonly bodyBatchSize: number;
	readonly mailboxFreshnessMs: number;
	readonly workerVersion: string;
}

export interface ProcessContext {
	readonly client: RemitClient<ImapWorkerQueueName>;
	readonly queues: WorkerQueues;
	readonly pool: ConnectionPool;
	readonly metrics: WorkerMetrics;
	readonly config: ImapWorkerConfig;
	readonly log: Logger;
	readonly oauth: TokenService;
	readonly bodySync: BodySyncGate;
	readonly accountObjects: AccountObjectStore;
}

export const alwaysEnabledBodySync: BodySyncGate = {
	isEnabled: async () => true,
};

export const DEFAULT_MAILBOX_FRESHNESS_MS = 60_000;

export const defaultImapWorkerConfig: ImapWorkerConfig = {
	attempts: {
		body: SYNC_WARNING_SURFACE_ATTEMPTS,
		placementMove: 3,
		flagPush: 3,
		appendSent: 3,
		messageMove: 3,
		messageDelete: 3,
		messageCopy: 3,
	},
	bodyBatchSize: 200,
	mailboxFreshnessMs: DEFAULT_MAILBOX_FRESHNESS_MS,
	workerVersion: "dev",
};
