import type {
	CreateOrganizeJobRequestInput,
	IOrganizeJobRequestRepository,
	OrganizeJobRequestItem,
} from "@remit/data-ports";
import { FilterMatchOperator } from "@remit/domain-enums";
import { NO_ACTION } from "./filters/match.js";

const ORGANIZE_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface OrganizeJobOwner {
	accountConfigId: string;
	userId: string;
}

export type OrganizeJobPredicate = Pick<
	CreateOrganizeJobRequestInput,
	"matchOperator" | "literalClauses" | "actionLabelId" | "actionMailboxId"
>;

export type OrganizeJobRequest = OrganizeJobOwner &
	({ predicate: OrganizeJobPredicate } | { filterId: string });

export interface OrganizeJobDeps {
	organizeJobRequest: Pick<IOrganizeJobRequestRepository, "create">;
	dispatchOrganizeJob: (job: OrganizeJobRequestItem) => Promise<void>;
}

export interface OrganizeJobMessage {
	type: "OrganizeJob";
	accountConfigId: string;
	organizeJobId: string;
}

export const organizeJobMessage = (
	job: Pick<OrganizeJobRequestItem, "accountConfigId" | "organizeJobId">,
): OrganizeJobMessage => ({
	type: "OrganizeJob",
	accountConfigId: job.accountConfigId,
	organizeJobId: job.organizeJobId,
});

const jobColumns = (
	request: OrganizeJobRequest,
): Omit<CreateOrganizeJobRequestInput, keyof OrganizeJobOwner | "ttl"> => {
	if ("filterId" in request) {
		return {
			filterId: request.filterId,
			matchOperator: FilterMatchOperator.And,
			literalClauses: [],
			actionLabelId: NO_ACTION,
			actionMailboxId: NO_ACTION,
		};
	}
	return { filterId: NO_ACTION, ...request.predicate };
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
	await deps.dispatchOrganizeJob(job);
	return job;
};
