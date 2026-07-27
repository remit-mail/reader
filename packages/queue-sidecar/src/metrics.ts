import { registry } from "@remit/logger-lambda/metrics";
import { Gauge } from "prom-client";
import type { QueueRecord, QueueStore } from "./store.js";

/**
 * Whether a queue is where work is sent or where it is quarantined. A
 * dead-letter queue is not a different kind of queue — it is a queue some other
 * queue redrives into — so the depth series is one metric and the role is a
 * label, derived from the redrive policies the store already holds.
 */
export type QueueRole = "work" | "dead_letter";

const queueMessages = new Gauge({
	name: "remit_queue_messages",
	help: "Messages currently on a queue, by queue and role.",
	labelNames: ["queue", "role"],
	registers: [registry],
});

export type QueueDepthSource = Pick<
	QueueStore,
	"listQueues" | "getQueueAttributes"
>;

export const queueRoles = (
	queues: readonly QueueRecord[],
): Map<string, QueueRole> => {
	const deadLetterTargets = new Set(
		queues.flatMap((queue) =>
			queue.deadLetterTargetName === null ? [] : [queue.deadLetterTargetName],
		),
	);
	return new Map(
		queues.map((queue) => [
			queue.name,
			deadLetterTargets.has(queue.name) ? "dead_letter" : "work",
		]),
	);
};

/**
 * Re-read every queue's depth. The whole series is replaced rather than added
 * to, so a purged or deleted queue stops reporting its last known depth instead
 * of pinning it forever.
 *
 * A store with no queues in it throws. A deployment always has the queues
 * `queues.json` declares, so an empty table means the sidecar is pointed at the
 * wrong `QUEUE_SIDECAR_DB`, or at a file `bootstrapQueues` never ran against.
 * Rendering that as a series with no samples is the same failure this endpoint
 * exists to remove: `remit_queue_messages{role="dead_letter"} > 0` never fires
 * and the operator is as blind as before, with a 200 saying otherwise.
 */
export const collectQueueDepths = (store: QueueDepthSource): void => {
	const queues = store.listQueues();
	if (queues.length === 0) {
		throw new Error(
			"queue store holds no queues — the sidecar is reading the wrong database, or none was bootstrapped",
		);
	}
	const roles = queueRoles(queues);
	queueMessages.reset();
	for (const queue of queues) {
		const attributes = store.getQueueAttributes(queue.name);
		queueMessages.set(
			{ queue: queue.name, role: roles.get(queue.name) ?? "work" },
			attributes.approximateNumberOfMessages,
		);
	}
};
