import { getClient, type RemitClient } from "@remit/backend/client";
import {
	type ApplyOrganizeDeps,
	applyOrganize,
	backApplyFilter,
	buildOrganizeMatchDeps,
	buildOrganizeMoveService,
	isFilterJob,
	matchOrganize,
	ORGANIZE_MATCH_LIMIT,
	type OrganizeMatchDeps,
	type OrganizeRejection,
	predicateFromJob,
} from "@remit/backend/organize";
import type { Logger } from "@remit/logger-lambda";
import type { OrganizeJobEvent } from "../events.js";

export interface ProcessOrganizeJobDeps {
	client?: RemitClient;
	matchDeps?: OrganizeMatchDeps;
	moveService?: ApplyOrganizeDeps["moveService"];
}

interface OrganizeOutcome {
	rejected: OrganizeRejection | null;
	matched: number;
	applied: number;
	failed: number;
	semanticUnavailable: boolean;
}

const rejectedOutcome = (rejected: OrganizeRejection): OrganizeOutcome => ({
	rejected,
	matched: 0,
	applied: 0,
	failed: 0,
	semanticUnavailable: false,
});

/**
 * The "all like these" pass: the predicate snapshotted on the row, over every
 * folder, every requested move applied (reader #497).
 */
const runSnapshot = async (
	client: RemitClient,
	matchDeps: OrganizeMatchDeps,
	moveService: ApplyOrganizeDeps["moveService"],
	job: Awaited<ReturnType<RemitClient["organizeJobRequest"]["get"]>>,
): Promise<OrganizeOutcome> => {
	const predicate = predicateFromJob(job);
	const match = await matchOrganize(
		matchDeps,
		job.accountConfigId,
		predicate,
		ORGANIZE_MATCH_LIMIT,
	);
	if (match.rejected) return rejectedOutcome(match.rejected);
	const { applied, failed } = await applyOrganize(
		{ client, moveService },
		job.accountConfigId,
		match.messageIds,
		predicate,
	);
	return {
		rejected: null,
		matched: match.messageIds.length,
		applied,
		failed,
		semanticUnavailable: match.semanticUnavailable,
	};
};

/**
 * Run a back-apply job (RFC 034, #1278): an "all like these" pass matches the
 * corpus against the job's snapshotted predicate; a filter job (#1354) runs the
 * named standing filter over the inbox with index-time move precedence. Either
 * applies the action to every match in one pass, then records the counts. Mirrors the export job's lifecycle —
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
		const matchDeps = deps.matchDeps ?? buildOrganizeMatchDeps(client);
		const moveService = deps.moveService ?? buildOrganizeMoveService(client);
		const outcome = isFilterJob(job)
			? await backApplyFilter(
					{ client, matchDeps, moveService },
					accountConfigId,
					job.filterId,
				).then((result) =>
					result.rejected ? rejectedOutcome(result.rejected) : result,
				)
			: await runSnapshot(client, matchDeps, moveService, job);

		if (outcome.rejected) {
			await client.organizeJobRequest.update(organizeJobId, {
				state: "Failed",
				matchedCount: 0,
				appliedCount: 0,
				failedCount: 0,
				errorMessage: outcome.rejected.message,
			});
			log.warn(
				{ accountConfigId, organizeJobId, reason: outcome.rejected.reason },
				"Organize back-apply refused the job's rule; failing the job without a retry",
			);
			return;
		}

		const { matched, applied, failed, semanticUnavailable } = outcome;
		await client.organizeJobRequest.update(organizeJobId, {
			state: "Complete",
			matchedCount: matched,
			appliedCount: applied,
			failedCount: failed,
		});
		log.info(
			{
				accountConfigId,
				organizeJobId,
				filterId: job.filterId,
				matched,
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
