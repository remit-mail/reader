import { getClient } from "@remit/backend/client";
import {
	applyOrganize,
	buildOrganizeMatchDeps,
	buildOrganizeMoveService,
	matchOrganize,
	ORGANIZE_MATCH_LIMIT,
	predicateFromJob,
} from "@remit/backend/organize";
import type { Logger } from "@remit/logger-lambda";
import type { OrganizeJobEvent } from "../events.js";

/**
 * Run a "all like these" back-apply job (RFC 034, #1278): match the corpus
 * against the job's snapshotted predicate and apply the action to every match,
 * in one pass, then record the counts. Mirrors the export job's lifecycle —
 * Running, then Complete/Failed — on the same fanout seam.
 *
 * Reuses the shared matcher (so the applied set equals what preview returned)
 * and the idempotent apply plumbing; `appliedByFilterId` is never written and no
 * Filter/FilterAnchor row is ever created. Both back-apply actions run here: the
 * additive label upsert and the exclusive folder move, the latter through the
 * same local-first placement mover body sync uses (`buildOrganizeMoveService`),
 * so a redelivered job re-applies both idempotently.
 */
export const processOrganizeJob = async (
	event: OrganizeJobEvent,
	log: Logger,
): Promise<void> => {
	const { accountConfigId, organizeJobId } = event;
	const client = await getClient();

	const job = await client.organizeJobRequest.get(organizeJobId);
	await client.organizeJobRequest.update(organizeJobId, { state: "Running" });
	log.info(
		{ accountConfigId, organizeJobId },
		"Organize back-apply processing started",
	);

	try {
		const predicate = predicateFromJob(job);
		const messageIds = await matchOrganize(
			buildOrganizeMatchDeps(client),
			accountConfigId,
			predicate,
			ORGANIZE_MATCH_LIMIT,
		);
		const { applied, failed } = await applyOrganize(
			{ client, moveService: buildOrganizeMoveService(client) },
			accountConfigId,
			messageIds,
			predicate,
		);

		await client.organizeJobRequest.update(organizeJobId, {
			state: "Complete",
			matchedCount: messageIds.length,
			appliedCount: applied,
			failedCount: failed,
		});
		log.info(
			{
				accountConfigId,
				organizeJobId,
				matched: messageIds.length,
				applied,
				failed,
			},
			"Organize back-apply complete",
		);
	} catch (error) {
		await client.organizeJobRequest.update(organizeJobId, {
			state: "Failed",
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
};
