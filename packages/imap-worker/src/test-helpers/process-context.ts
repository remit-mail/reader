import { noopLogger } from "@remit/logger";
import {
	defaultImapWorkerConfig,
	type ImapFailureKind,
	type ProcessContext,
	type WorkerMetrics,
} from "../context.js";

export const unusedPort = <T extends object>(name: string): T =>
	new Proxy({} as T, {
		get: (_target, key) => {
			throw new Error(`${name}.${String(key)} is not part of this test`);
		},
	});

export interface RecordedFailure {
	operation: string;
	kind: ImapFailureKind;
	count: number;
}

export const recordingMetrics = (): WorkerMetrics & {
	failures: RecordedFailure[];
} => {
	const failures: RecordedFailure[] = [];
	return {
		failures,
		imapFailure: (operation, kind, count) => {
			failures.push({ operation, kind, count });
		},
	};
};

export const processContext = (
	overrides: Partial<ProcessContext>,
): ProcessContext => ({
	client: unusedPort("client"),
	queues: unusedPort("queues"),
	pool: unusedPort("pool"),
	metrics: recordingMetrics(),
	config: { ...defaultImapWorkerConfig, workerVersion: "test" },
	log: noopLogger,
	oauth: unusedPort("oauth"),
	accountObjects: unusedPort("accountObjects"),
	...overrides,
});
