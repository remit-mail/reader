import type { ProcessContext } from "../context.js";
import type { DeleteAccountObjectsEvent } from "../events.js";
import type { WorkerQueues } from "../queues.js";

const MIN_REMAINING_MS = 30_000;

export const handleDeleteAccountObjects = async (
	event: DeleteAccountObjectsEvent,
	ctx: ProcessContext,
	getRemainingTimeMs?: () => number,
): Promise<void> => {
	const { log, queues, accountObjects } = ctx;
	const { accountConfigId, continuationToken } = event;
	const prefix = `accounts/${accountConfigId}/`;

	log.info(
		{ accountConfigId, prefix, hasContinuation: !!continuationToken },
		"Deleting account objects from S3",
	);

	let currentToken = continuationToken;
	let totalDeleted = 0;

	while (true) {
		// Check remaining time before starting a new page
		if (getRemainingTimeMs && getRemainingTimeMs() < MIN_REMAINING_MS) {
			log.info(
				{ accountConfigId, totalDeleted, continuationToken: currentToken },
				"Near timeout, re-enqueuing with continuation token",
			);
			await reenqueue(queues, accountConfigId, currentToken);
			return;
		}

		const page = await accountObjects.list(prefix, currentToken);

		if (page.keys.length > 0) {
			await accountObjects.delete(page.keys);
			totalDeleted += page.keys.length;
		}

		if (page.nextContinuationToken === undefined) {
			break;
		}

		currentToken = page.nextContinuationToken;
	}

	log.info(
		{ accountConfigId, totalDeleted },
		"Finished deleting account objects",
	);
};

const reenqueue = async (
	queues: WorkerQueues,
	accountConfigId: string,
	continuationToken: string | undefined,
): Promise<void> => {
	const event: DeleteAccountObjectsEvent = {
		type: "DELETE_ACCOUNT_OBJECTS",
		accountConfigId,
		continuationToken,
	};

	await queues.messageManagement.send({ body: event });
};
