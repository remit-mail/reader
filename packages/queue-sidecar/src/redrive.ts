import type { QueueStore } from "./store.js";

export type RedriveVerdict =
	| { kind: "redrive" }
	| { kind: "refuse"; reason: string };

const REPLAYABLE = new Set([
	"remit-body-dlq",
	"remit-flags-dlq.fifo",
	"remit-message-mgmt-dlq",
]);

const RESYNCED = new Set([
	"remit-mailboxes-dlq.fifo",
	"remit-messages-dlq.fifo",
]);

/**
 * Which dead-letter queues are safe to replay. Body syncs, flag pushes and
 * filings re-read the row before they act, so a replay months later does the
 * right thing or nothing. A send does not: its outbox row may still read
 * `sending`, and the replay would deliver mail the user gave up on.
 */
export const redriveVerdict = (deadLetterQueue: string): RedriveVerdict => {
	if (REPLAYABLE.has(deadLetterQueue)) return { kind: "redrive" };
	if (deadLetterQueue === "remit-smtp-dlq") {
		return {
			kind: "refuse",
			reason:
				"remit-smtp-dlq holds sends. Replaying one can deliver mail the user stopped expecting, possibly months old; read each message and delete it instead.",
		};
	}
	if (RESYNCED.has(deadLetterQueue)) {
		return {
			kind: "refuse",
			reason: `${deadLetterQueue} holds folder syncs, and the scheduler queues a fresh one for every folder on its own. Purge it instead.`,
		};
	}
	return {
		kind: "refuse",
		reason: `${deadLetterQueue} is not a dead-letter queue remit redrives; it redrives remit-body-dlq, remit-flags-dlq.fifo and remit-message-mgmt-dlq.`,
	};
};

export const redriveOnRelease = (store: QueueStore, release: string): void =>
	store.redriveForRelease(
		release,
		store
			.listQueues()
			.map((queue) => queue.name)
			.filter((name) => redriveVerdict(name).kind === "redrive"),
	);

export interface RedriveOptions {
	deadLetterQueue: string;
	baseUrl: string;
	accountId?: string;
}

export type RedriveOutcome =
	| { kind: "moved"; count: number }
	| { kind: "refused"; reason: string }
	| { kind: "failed"; reason: string };

const call = async (
	baseUrl: string,
	params: Record<string, string>,
): Promise<{ ok: true; body: string } | { ok: false; reason: string }> => {
	const response = await fetch(`${baseUrl}/`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ...params, Version: "2012-11-05" }),
	});
	const body = await response.text();
	if (response.ok) return { ok: true, body };
	return {
		ok: false,
		reason: body.match(/<Message>(.*)<\/Message>/)?.[1] ?? body,
	};
};

export const redrive = async (
	options: RedriveOptions,
): Promise<RedriveOutcome> => {
	const { deadLetterQueue, baseUrl } = options;
	const accountId = options.accountId ?? "000000000000";
	const verdict = redriveVerdict(deadLetterQueue);
	if (verdict.kind === "refuse") {
		return { kind: "refused", reason: verdict.reason };
	}

	const depth = await call(baseUrl, {
		Action: "GetQueueAttributes",
		QueueUrl: `${baseUrl}/${accountId}/${deadLetterQueue}`,
		"AttributeName.1": "ApproximateNumberOfMessages",
	});
	if (!depth.ok) return { kind: "failed", reason: depth.reason };

	const moved = await call(baseUrl, {
		Action: "StartMessageMoveTask",
		SourceArn: `arn:aws:sqs:local:${accountId}:${deadLetterQueue}`,
	});
	if (!moved.ok) return { kind: "failed", reason: moved.reason };

	return {
		kind: "moved",
		count: Number(depth.body.match(/<Value>(\d+)<\/Value>/)?.[1] ?? "0"),
	};
};

export interface RedriveCliIo {
	env: NodeJS.ProcessEnv;
	out: (text: string) => void;
	err: (text: string) => void;
}

export const runRedriveCli = async (
	args: string[],
	io: RedriveCliIo,
): Promise<number> => {
	const [deadLetterQueue, ...rest] = args;
	if (!deadLetterQueue || rest.length > 0) {
		io.err("usage: redrive <dead-letter-queue>\n");
		return 2;
	}
	const outcome = await redrive({
		deadLetterQueue,
		baseUrl: `http://127.0.0.1:${io.env.QUEUE_SIDECAR_PORT ?? "9324"}`,
		accountId: io.env.QUEUE_SIDECAR_ACCOUNT_ID,
	});
	if (outcome.kind === "moved") {
		io.out(
			`Moved ${outcome.count} message(s) from ${deadLetterQueue} back to the queue it came from.\n`,
		);
		return 0;
	}
	io.err(`redrive: ${outcome.reason}\n`);
	return outcome.kind === "refused" ? 2 : 1;
};
