import { redriveVerdict } from "./redrive.js";
import type { QueueStore, ReleaseRedrive } from "./store.js";

/**
 * Every replayable dead-letter queue the store holds, redriven once for this
 * release. Mail stranded by a bug the release fixes gets one more try without
 * the operator running `remit redrive`; mail that fails again stays put.
 */
export const redriveOnRelease = (
	store: QueueStore,
	release: string,
	now = Date.now(),
): ReleaseRedrive[] =>
	store
		.listQueues()
		.filter((queue) => redriveVerdict(queue.name).kind === "redrive")
		.map((queue) => store.redriveForRelease(queue.name, release, now));
