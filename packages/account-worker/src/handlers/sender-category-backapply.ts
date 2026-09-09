import { getClient, type RemitClient } from "@remit/backend/client";
import {
	backApplySenderCategory,
	SENDER_CATEGORY_BACKAPPLY_LIMIT,
} from "@remit/backend/sender-category";
import { NotFoundError } from "@remit/data-ports/errors";
import type { Logger } from "@remit/logger-lambda";
import type { SenderCategoryBackApplyEvent } from "../events.js";

export interface ProcessSenderCategoryBackApplyDeps {
	client?: RemitClient;
}

/**
 * Whether the override this job was fired for is still the one standing on the
 * Address. Both halves are compared: `value` alone would let a set → clear →
 * re-set to the same category count as unchanged, and `setAt` alone would
 * refuse a legitimate redelivery.
 *
 * A vanished Address is a stale job, not a fault — the account was purged
 * between the PATCH and the delivery — so it declines quietly. Every other
 * read failure propagates, because a job that cannot tell whether it is stale
 * must not guess.
 */
const overrideStillStands = async (
	client: RemitClient,
	event: SenderCategoryBackApplyEvent,
): Promise<boolean> => {
	const address = await client.address
		.getAddress(event.accountConfigId, event.addressId)
		.catch((error: unknown) => {
			if (error instanceof NotFoundError) return undefined;
			throw error;
		});
	const flag = address?.flags?.category;
	return flag?.value === event.category && flag?.setAt === event.categorySetAt;
};

/**
 * Run the retroactive half of a sender-category override (#415): re-label the
 * bounded recent batch of that sender's already-classified mail, in one pass.
 * Rides the organize back-apply's seam without its job row — a flag PATCH
 * returns the address, not a job to poll, so there is no lifecycle for a client
 * to read and nothing for a row to carry.
 *
 * The delivery is at-least-once and unordered, so the pass starts by
 * re-reading the flag and declines unless the set it was fired for is still
 * the standing one ({@link overrideStillStands}). Re-labelling blind would let
 * a redelivered job undo a correction the user has since made.
 *
 * A pass in which any message failed is NOT acknowledged: the writes are
 * idempotent and the converged rows are skipped on the way through, so
 * redelivery re-runs only what is still wrong. Acknowledging instead would
 * leave a message whose thread rows were re-labelled but whose Message row was
 * not — the badge and the detail view disagreeing, permanently, with nothing
 * left to repair it.
 */
export const processSenderCategoryBackApply = async (
	event: SenderCategoryBackApplyEvent,
	log: Logger,
	deps: ProcessSenderCategoryBackApplyDeps = {},
): Promise<void> => {
	const { accountConfigId, addressId, normalizedEmail, category } = event;
	const client = deps.client ?? (await getClient());

	if (!(await overrideStillStands(client, event))) {
		log.warn(
			{ accountConfigId, addressId, category },
			"Sender category back-apply skipped: the override it was fired for no longer stands",
		);
		return;
	}

	const result = await backApplySenderCategory(
		{ client },
		accountConfigId,
		normalizedEmail,
		category,
	);

	// biome-ignore lint/plugin/no-logger-info: a back-apply is an audit-grade signal
	log.info(
		{
			accountConfigId,
			addressId,
			category,
			limit: SENDER_CATEGORY_BACKAPPLY_LIMIT,
			...result,
		},
		"Sender category back-apply pass finished",
	);

	if (result.failed > 0) {
		throw new Error(
			`Sender category back-apply left ${result.failed} of ${result.matched} messages unlabelled for address ${addressId}`,
		);
	}
};
