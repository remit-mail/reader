import {
	type CreateOrganizeJobRequestInput,
	FILTER_NO_ACTION,
	filterRuleFromClauses,
	type IOrganizeJobRequestRepository,
	type OrganizeJobEvent,
	type OrganizeJobRequestItem,
	type QueueProducer,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { FilterMatchOperator } from "@remit/domain-enums";
import { accept, invalid, type Refusable } from "./refusal.js";

const ORGANIZE_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface OrganizeJobOwner {
	accountConfigId: string;
	userId: string;
}

export type OrganizeJobPredicate = Pick<
	CreateOrganizeJobRequestInput,
	| "rule"
	| "sourceMailboxId"
	| "sentAfter"
	| "sentBefore"
	| "actionLabelId"
	| "actionMailboxId"
>;

export type OrganizeJobRequest = OrganizeJobOwner &
	(
		| { predicate: OrganizeJobPredicate }
		| { filterId: string }
		| { continues: OrganizeJobRequestItem }
	);

export interface OrganizeJobLogger {
	info(obj: Record<string, unknown>, msg: string): void;
}

export interface OrganizeJobDeps {
	organizeJobRequest: Pick<IOrganizeJobRequestRepository, "create">;
	queue: QueueProducer<OrganizeJobEvent>;
	logger: OrganizeJobLogger;
}

const jobColumns = (
	request: OrganizeJobRequest,
): Omit<CreateOrganizeJobRequestInput, keyof OrganizeJobOwner | "ttl"> => {
	if ("continues" in request) {
		const previous = request.continues;
		return {
			filterId: previous.filterId,
			rule: previous.rule,
			actionLabelId: previous.actionLabelId,
			actionMailboxId: previous.actionMailboxId,
			sourceMailboxId: previous.sourceMailboxId,
			sentAfter: previous.sentAfter,
			sentBefore: previous.sentBefore,
			startPosition: previous.nextPosition,
		};
	}
	if ("filterId" in request) {
		return {
			filterId: request.filterId,
			rule: filterRuleFromClauses({
				matchOperator: FilterMatchOperator.And,
				literalClauses: [],
			}),
			actionLabelId: FILTER_NO_ACTION,
			actionMailboxId: FILTER_NO_ACTION,
			sourceMailboxId: FILTER_NO_ACTION,
			sentAfter: FILTER_NO_ACTION,
			sentBefore: FILTER_NO_ACTION,
			startPosition: "",
		};
	}
	return {
		filterId: FILTER_NO_ACTION,
		startPosition: "",
		...request.predicate,
	};
};

/** The cursor a job hands out: set once it completed with matches left. */
export const organizeJobCursor = (
	job: Pick<OrganizeJobRequestItem, "organizeJobId" | "remainingCount">,
): string => (job.remainingCount > 0 ? job.organizeJobId : "");

export const CURSOR_REFUSAL =
	"This cursor continues nothing: use the cursor a finished organize job returned while it reported messages remaining.";

/**
 * The job a cursor continues, when it belongs to this config and still has
 * matches left. Anything else is refused, never a fresh selection.
 */
export const continuedJob = async (
	organizeJobRequest: Pick<IOrganizeJobRequestRepository, "get">,
	accountConfigId: string,
	cursor: string,
): Promise<Refusable<OrganizeJobRequestItem>> => {
	const job = await organizeJobRequest.get(cursor).catch((error: unknown) => {
		if (error instanceof NotFoundError) return null;
		throw error;
	});
	if (
		!job ||
		job.accountConfigId !== accountConfigId ||
		organizeJobCursor(job) !== cursor
	) {
		return invalid(CURSOR_REFUSAL);
	}
	return accept(job);
};

// A filter job names only the filter; the worker reads it when it runs.
export const queueOrganizeJob = async (
	deps: OrganizeJobDeps,
	request: OrganizeJobRequest,
): Promise<OrganizeJobRequestItem> => {
	const job = await deps.organizeJobRequest.create({
		accountConfigId: request.accountConfigId,
		userId: request.userId,
		...jobColumns(request),
		ttl: Math.floor(Date.now() / 1000) + ORGANIZE_JOB_TTL_SECONDS,
	});

	await deps.queue.send({
		body: {
			type: "OrganizeJob",
			accountConfigId: job.accountConfigId,
			organizeJobId: job.organizeJobId,
		},
	});

	deps.logger.info(
		{
			accountConfigId: job.accountConfigId,
			organizeJobId: job.organizeJobId,
			filterId: job.filterId,
		},
		"Organize back-apply job initiated",
	);
	return job;
};
