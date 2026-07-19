import type {
	CreateFilterInput,
	FilterResponse,
	UpdateFilterInput,
} from "@remit/api-openapi-types";
import type { FilterItem } from "@remit/data-ports";
import { ClientError } from "@remit/data-ports/errors";
import { FilterScope } from "@remit/domain-enums";
import type { AnchorPayload } from "@remit/search-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import { buildFilterAnchor } from "../service/filter.js";
import type {
	FilterDetailOperationIds,
	FilterOperationIds,
	OperationHandler,
} from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";

/**
 * Minimal filter-service surface the CRUD handlers need — declared as a `Pick`
 * so tests can stub it without a live table.
 */
export interface FilterCrudDeps {
	filter: {
		create(input: {
			accountConfigId: string;
			name: string;
			scope: FilterItem["scope"];
			expiresAt?: string;
			ttl?: number;
			matchOperator: FilterItem["matchOperator"];
			literalClauses: FilterItem["literalClauses"];
			actionLabelId: string;
			actionMailboxId: string;
			hasAnchor: boolean;
		}): Promise<FilterItem>;
		get(accountConfigId: string, filterId: string): Promise<FilterItem>;
		update(
			accountConfigId: string,
			filterId: string,
			input: Partial<UpdateFilterInput>,
		): Promise<FilterItem>;
		delete(accountConfigId: string, filterId: string): Promise<void>;
		refreshExpiry(item: FilterItem): Promise<FilterItem>;
		listPageByAccountConfig(
			accountConfigId: string,
			options?: { limit?: number; continuationToken?: string },
		): Promise<{ items: FilterItem[]; continuationToken: string | undefined }>;
	};
	filterAnchor: {
		put(input: {
			accountConfigId: string;
			filterId: string;
			anchorMessageId: string;
			anchorEmbedding: number[];
			anchorEmbeddingId: string;
			anchorSourceText: string;
		}): Promise<unknown>;
	};
	buildAnchor(
		accountConfigId: string,
		anchorMessageId: string,
	): Promise<AnchorPayload | null>;
}

/**
 * Epoch-seconds `ttl` derived from `expiresAt`, set only for a `Temporary`
 * filter (RFC 034 Decision 1.3). A `Standing` filter never carries `ttl` — the
 * reserved table-wide TTL attribute must stay absent, or the row would be swept
 * (Decision 1.4).
 */
export const deriveFilterTtl = (
	scope: string,
	expiresAt: string | undefined,
): number | undefined => {
	if (scope !== FilterScope.Temporary || !expiresAt) return undefined;
	const ms = new Date(expiresAt).getTime();
	if (Number.isNaN(ms)) {
		throw new ClientError(`Invalid expiresAt: ${expiresAt}`);
	}
	return Math.floor(ms / 1000);
};

/**
 * Reduce a PATCH body to the fields a filter update may set (RFC 034). Preserves
 * absence: a key not present in the body is not present in the patch, so a
 * name-only rename yields `{ name }` and never touches a predicate/action field
 * — the service's `changesPredicateOrAction` guard then leaves `ruleChangedAt`
 * untouched (Decision 3.2). Any field outside this set — most notably a
 * server-derived `state`/`ruleChangedAt` smuggled into the body — is dropped.
 */
export const pickFilterUpdate = (
	body: Partial<UpdateFilterInput>,
): Partial<UpdateFilterInput> => {
	const patch: Partial<UpdateFilterInput> = {};
	if (Object.hasOwn(body, "name")) patch.name = body.name;
	if (Object.hasOwn(body, "matchOperator")) {
		patch.matchOperator = body.matchOperator;
	}
	if (Object.hasOwn(body, "literalClauses")) {
		patch.literalClauses = body.literalClauses;
	}
	if (Object.hasOwn(body, "actionLabelId")) {
		patch.actionLabelId = body.actionLabelId;
	}
	if (Object.hasOwn(body, "actionMailboxId")) {
		patch.actionMailboxId = body.actionMailboxId;
	}
	return patch;
};

const toFilterResponse = (item: FilterItem): FilterResponse => ({
	filterId: item.filterId,
	accountConfigId: item.accountConfigId,
	name: item.name,
	scope: item.scope,
	expiresAt: item.expiresAt,
	state: item.state,
	hasAnchor: item.hasAnchor,
	ruleChangedAt: item.ruleChangedAt,
	matchOperator: item.matchOperator,
	literalClauses: item.literalClauses,
	actionLabelId: item.actionLabelId,
	actionMailboxId: item.actionMailboxId,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

/**
 * Create a filter, wiring the semantic anchor when `anchorMessageId` is set
 * (RFC 034 Decision 2). The anchor is built first, before the row is written,
 * so `hasAnchor` is set correctly at creation and the sibling `FilterAnchor`
 * row is written against the new `filterId` — never a second round-trip that
 * would bump `ruleChangedAt`. A message with no indexed chunks yields no anchor:
 * the filter is created as purely literal (`hasAnchor: false`) rather than with
 * an empty anchor.
 */
export const createFilterWithAnchor = async (
	deps: FilterCrudDeps,
	accountConfigId: string,
	input: CreateFilterInput,
): Promise<FilterItem> => {
	const { anchorMessageId } = input;
	const anchor = anchorMessageId
		? await deps.buildAnchor(accountConfigId, anchorMessageId)
		: null;

	const filter = await deps.filter.create({
		accountConfigId,
		name: input.name,
		scope: input.scope,
		expiresAt: input.expiresAt,
		ttl: deriveFilterTtl(input.scope, input.expiresAt),
		matchOperator: input.matchOperator,
		literalClauses: input.literalClauses,
		actionLabelId: input.actionLabelId,
		actionMailboxId: input.actionMailboxId,
		hasAnchor: anchor !== null,
	});

	if (anchor && anchorMessageId) {
		await deps.filterAnchor.put({
			accountConfigId,
			filterId: filter.filterId,
			anchorMessageId,
			anchorEmbedding: anchor.anchorEmbedding,
			anchorEmbeddingId: anchor.anchorEmbeddingId,
			anchorSourceText: anchor.anchorSourceText,
		});
	}

	return filter;
};

export const FilterOperations: Record<
	FilterOperationIds,
	OperationHandler<FilterOperationIds>
> = {
	FilterOperations_listFilters: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		const { filter } = client;
		const page = await filter.listPageByAccountConfig(accountConfigId, {
			continuationToken,
		});

		// Reading the list is one of the touch points that lazily expires a past
		// Temporary filter (RFC 034 Decision 1.2) — a no-op write for Standing or
		// not-yet-expired filters.
		const items = await Promise.all(
			page.items.map((item) => filter.refreshExpiry(item)),
		);

		return {
			items: items.map(toFilterResponse),
			continuationToken: page.continuationToken,
		};
	},

	FilterOperations_createFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const input = context.request.requestBody as CreateFilterInput;

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const filter = await createFilterWithAnchor(
			{
				filter: client.filter,
				filterAnchor: client.filterAnchor,
				buildAnchor: buildFilterAnchor,
			},
			accountConfigId,
			input,
		);
		return toFilterResponse(filter);
	},
};

export const FilterDetailOperations: Record<
	FilterDetailOperationIds,
	OperationHandler<FilterDetailOperationIds>
> = {
	FilterDetailOperations_getFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, filterId } = context.request.params as {
			accountId: string;
			filterId: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		const { filter } = client;
		const item = await filter.get(accountConfigId, filterId);
		const refreshed = await filter.refreshExpiry(item);
		return toFilterResponse(refreshed);
	},

	FilterDetailOperations_updateFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, filterId } = context.request.params as {
			accountId: string;
			filterId: string;
		};
		const body = context.request.requestBody as Partial<UpdateFilterInput>;

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const { filter } = client;
		const updated = await filter.update(
			accountConfigId,
			filterId,
			pickFilterUpdate(body),
		);
		return toFilterResponse(updated);
	},

	FilterDetailOperations_deleteFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, filterId } = context.request.params as {
			accountId: string;
			filterId: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const { filter } = client;
		await filter.delete(accountConfigId, filterId);
		return { statusCode: 204 };
	},
};
