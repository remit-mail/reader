import type {
	CreateOrganizeJobRequestInput,
	OrganizeJobRequestItem,
	ResultList,
	UpdateOrganizeJobRequestInput,
} from "../types.js";

export interface IOrganizeJobRequestRepository {
	create(input: CreateOrganizeJobRequestInput): Promise<OrganizeJobRequestItem>;
	get(organizeJobId: string): Promise<OrganizeJobRequestItem>;
	update(
		organizeJobId: string,
		input: UpdateOrganizeJobRequestInput,
	): Promise<OrganizeJobRequestItem>;
	listByAccountConfig(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<OrganizeJobRequestItem>>;
}
