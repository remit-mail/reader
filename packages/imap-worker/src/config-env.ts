import { attemptBudget } from "@remit/sqs-client/attempt-budget";
import type { ConnectionPoolOptions } from "./connection-pool.js";
import {
	DEFAULT_MAILBOX_FRESHNESS_MS,
	defaultImapWorkerConfig,
	type ImapWorkerConfig,
} from "./context.js";
import { workerVersion } from "./worker-version.js";

const DEFAULT_CONNECTIONS_PER_ACCOUNT = 2;
const BODY_BATCH_SIZE = 200;
const BODY_PROCESS_CONCURRENCY = 8;
const BODY_PROCESS_BYTES_IN_FLIGHT = 256 * 1024 * 1024;

// Deployments that drive sync from a test harness set MAILBOX_FRESHNESS_MS low
// so their explicit nudges are never no-oped by the freshness gate.
export const resolveMailboxFreshnessMs = (env: NodeJS.ProcessEnv): number => {
	const value = env.MAILBOX_FRESHNESS_MS?.trim();
	if (!value) return DEFAULT_MAILBOX_FRESHNESS_MS;
	const raw = Number(value);
	return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_MAILBOX_FRESHNESS_MS;
};

export const imapWorkerConfigFromEnv = (
	env: NodeJS.ProcessEnv,
): ImapWorkerConfig => {
	const { attempts } = defaultImapWorkerConfig;
	return {
		attempts: {
			body: attemptBudget("BODY_SYNC_MAX_ATTEMPTS", attempts.body, env),
			placementMove: attemptBudget(
				"PLACEMENT_MOVE_MAX_ATTEMPTS",
				attempts.placementMove,
				env,
			),
			flagPush: attemptBudget("FLAG_PUSH_MAX_ATTEMPTS", attempts.flagPush, env),
			appendSent: attemptBudget(
				"APPEND_SENT_MAX_ATTEMPTS",
				attempts.appendSent,
				env,
			),
			messageMove: attemptBudget(
				"MESSAGE_MOVE_MAX_ATTEMPTS",
				attempts.messageMove,
				env,
			),
			messageDelete: attemptBudget(
				"MESSAGE_DELETE_MAX_ATTEMPTS",
				attempts.messageDelete,
				env,
			),
			messageCopy: attemptBudget(
				"MESSAGE_COPY_MAX_ATTEMPTS",
				attempts.messageCopy,
				env,
			),
		},
		bodyBatchSize: BODY_BATCH_SIZE,
		bodyProcessConcurrency: BODY_PROCESS_CONCURRENCY,
		bodyProcessBytesInFlight: BODY_PROCESS_BYTES_IN_FLIGHT,
		mailboxFreshnessMs: resolveMailboxFreshnessMs(env),
		messageObjectDeleteConcurrency:
			defaultImapWorkerConfig.messageObjectDeleteConcurrency,
		workerVersion: workerVersion(),
	};
};

export const poolOptionsFromEnv = (
	env: NodeJS.ProcessEnv,
): ConnectionPoolOptions => {
	const raw = Number(env.CONNECTIONS_PER_ACCOUNT);
	return {
		size:
			Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_CONNECTIONS_PER_ACCOUNT,
		overflow: "Open",
	};
};
