import { getClient, type RemitClient } from "@remit/backend/client";
import {
	backApplySenderCategory,
	SENDER_CATEGORY_BACKAPPLY_LIMIT,
} from "@remit/backend/sender-category";
import type { Logger } from "@remit/logger-lambda";
import type { SenderCategoryBackApplyEvent } from "../events.js";

export interface ProcessSenderCategoryBackApplyDeps {
	client?: RemitClient;
}

/**
 * Run the retroactive half of a sender-category override (#415): re-label the
 * bounded recent batch of that sender's already-classified mail, in one pass.
 * Rides the organize back-apply's seam without its job row — a flag PATCH
 * returns the address, not a job to poll, so there is no lifecycle for a client
 * to read and nothing for a row to carry.
 *
 * Every failure propagates: the pass writes only local rows with idempotent
 * writes, so partial batch failure redelivering the record simply re-runs it,
 * and a redelivery after a half-finished pass converges on the same state.
 */
export const processSenderCategoryBackApply = async (
	event: SenderCategoryBackApplyEvent,
	log: Logger,
	deps: ProcessSenderCategoryBackApplyDeps = {},
): Promise<void> => {
	const { accountConfigId, addressId, normalizedEmail, category } = event;
	const client = deps.client ?? (await getClient());

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
		"Sender category back-apply complete",
	);
};
