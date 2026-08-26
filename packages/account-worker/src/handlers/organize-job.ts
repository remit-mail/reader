import { getClient, type RemitClient } from "@remit/backend/client";
import {
	applyOrganize,
	buildOrganizeMatchDeps,
	buildOrganizeMoveService,
	matchOrganize,
	ORGANIZE_MATCH_LIMIT,
	type OrganizeMatchDeps,
	predicateFromJob,
} from "@remit/backend/organize";
import type { Logger } from "@remit/logger-lambda";
import type { OrganizeJobEvent } from "../events.js";

export interface ProcessOrganizeJobDeps {
	client?: RemitClient;
	matchDeps?: OrganizeMatchDeps;
}

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
 *
 * Two failures, two treatments (reader #463). A predicate this deployment's
 * matcher refuses is a rejected client input: the job row records the reason and
 * the record is acknowledged, because redelivering the same snapshotted
 * predicate can only be refused again — retrying it to the DLQ buries a 4xx in
 * the infrastructure alarms. Everything else — the SQS/DDB/S3-class failure a
 * retry can actually clear — fails the row and propagates, so partial batch
 * failure redelivers it.
 */
export const processOrganizeJob = async (
	event: OrganizeJobEvent,
	log: Logger,
	deps: ProcessOrganizeJobDeps = {},
): Promise<void> => {
	const { accountConfigId, organizeJobId } = event;
	const client = deps.client ?? (await getClient());

	const job = await client.organizeJobRequest.get(organizeJobId);
	await client.organizeJobRequest.update(organizeJobId, { state: "Running" });
	log.info(
		{ accountConfigId, organizeJobId },
		"Organize back-apply processing started",
	);

	try {
		const predicate = predicateFromJob(job);
		const matchDeps = deps.matchDeps ?? buildOrganizeMatchDeps(client);
		const match = await matchOrganize(
			matchDeps,
			accountConfigId,
			predicate,
			ORGANIZE_MATCH_LIMIT,
		);

		if (match.rejected) {
			await client.organizeJobRequest.update(organizeJobId, {
				state: "Failed",
				matchedCount: 0,
				appliedCount: 0,
				failedCount: 0,
				errorMessage: match.rejected.message,
			});
			log.warn(
				{ accountConfigId, organizeJobId, reason: match.rejected.reason },
				"Organize back-apply refused the job's rule; failing the job without a retry",
			);
			return;
		}

		const { messageIds, semanticUnavailable } = match;
		const { applied, failed } = await applyOrganize(
			{
				client,
				moveService: buildOrganizeMoveService(client),
				match: matchDeps,
			},
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
				semanticUnavailable,
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
