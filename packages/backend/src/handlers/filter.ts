import type {
	CreateFilterInput,
	FilterResponse,
	UpdateFilterInput as UpdateFilterRequestBody,
} from "@remit/api-openapi-types";
import type {
	FilterItem,
	IFilterAnchorTransaction,
	UpdateFilterInput,
} from "@remit/data-ports";
import { BadRequestError } from "@remit/data-ports/errors";
import { FilterScope, FilterState } from "@remit/domain-enums";
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
 * Minimal filter-service surface the create handler needs — declared as a
 * `Pick` so tests can stub it without a live table.
 */
export interface FilterCrudDeps {
	/**
	 * Creates the `Filter` row and its optional sibling `FilterAnchor` row in
	 * one transaction (#351) — a failure on the anchor write can never leave a
	 * `Filter` durably marked `hasAnchor: true` with no matching anchor row,
	 * and it surfaces as a failed create request rather than a silently
	 * broken filter.
	 */
	filterAnchorTransaction: IFilterAnchorTransaction;
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
		throw new BadRequestError(`Invalid expiresAt: ${expiresAt}`);
	}
	return Math.floor(ms / 1000);
};

/**
 * Reduce a PATCH body to the fields a filter update may set (RFC 034, reader
 * #266). Preserves absence: a key not present in the body is not present in
 * the patch, so a name-only rename yields `{ name }` and never touches a
 * predicate/action/scope/expiresAt field — the service's
 * `changesRuleAssertion` guard then leaves `ruleChangedAt` untouched (Decision
 * 3.2). Any field outside this set — most notably a server-derived
 * `state`/`ttl`/`hasAnchor`/`ruleChangedAt` smuggled into the body — is
 * dropped. `scope`/`expiresAt` land here as the caller sent them; a patch that
 * touches either still needs `resolveFilterScopeExpiry` to merge them against
 * the stored row and derive `ttl`/`state` before this reaches the repo.
 */
export const pickFilterUpdate = (
	body: Partial<UpdateFilterRequestBody>,
): Partial<UpdateFilterInput> => {
	const patch: Partial<UpdateFilterInput> = {};
	if (Object.hasOwn(body, "name")) patch.name = body.name;
	if (Object.hasOwn(body, "scope")) patch.scope = body.scope;
	if (Object.hasOwn(body, "expiresAt")) patch.expiresAt = body.expiresAt;
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

/**
 * A filter's semantic anchor is set once, from `anchorMessageId`, only on
 * `CreateFilterInput` (RFC 034 Decision 2) — the generated `UpdateFilterInput`
 * carries no anchor field at all, so a well-behaved client cannot express this.
 * This only catches a caller handing the raw PATCH body an anchor field
 * anyway, and rejects it loudly rather than silently dropping it (reader
 * #266): repointing an anchor would silently change what a saved filter
 * matches with nothing visible changing, and that deserves a new filter
 * instead — scope and expiry cover the rest of what changed here.
 */
const ANCHOR_MUTATION_FIELDS = ["anchorMessageId"] as const;

export const rejectAnchorMutation = (body: Record<string, unknown>): void => {
	const attempted = ANCHOR_MUTATION_FIELDS.find((field) =>
		Object.hasOwn(body, field),
	);
	if (!attempted) return;
	throw new BadRequestError(
		"A filter's semantic anchor can't change after creation — create a new filter instead.",
	);
};

export interface ResolvedScopeExpiry {
	scope: FilterItem["scope"];
	expiresAt?: string;
	ttl?: number;
	state: FilterItem["state"];
}

/**
 * Merge a PATCH body's `scope`/`expiresAt` against the filter's stored values
 * and resolve the full set the row must land on (reader #266). Only called
 * when the patch touches `scope` or `expiresAt` — one that touches neither
 * leaves both, and `ttl`/`state`, untouched exactly as before this ticket.
 *
 * A `Temporary` result always carries a defined `expiresAt` — moving to
 * `Temporary` without one is rejected, matching the Filter model's invariant
 * that a Temporary filter always has an expiry (RFC 034 Decision 1.1). Moving
 * to `Standing` clears `expiresAt`/`ttl`, matching the model's invariant that
 * both stay absent outside `Temporary` (RFC 034 Decision 1.4) — the reserved
 * `ttl` attribute must never linger once a filter is no longer temporary.
 *
 * `state` is recomputed the same comparison `refreshExpiry` runs, so a filter
 * extended past a lapsed `expiresAt` (or switched to `Standing`) reads Active
 * immediately — the index-time worker's `byAccountAndState` query needs that
 * now, not on whatever read happens to touch the row next.
 */
export const resolveFilterScopeExpiry = (
	current: Pick<FilterItem, "scope" | "expiresAt">,
	patch: Partial<UpdateFilterInput>,
): ResolvedScopeExpiry => {
	const scope = patch.scope ?? current.scope;

	if (scope !== FilterScope.Temporary) {
		if (Object.hasOwn(patch, "expiresAt") && patch.expiresAt) {
			throw new BadRequestError(
				"expiresAt only applies to a Temporary filter — switch scope to Temporary to set one.",
			);
		}
		return {
			scope,
			expiresAt: undefined,
			ttl: undefined,
			state: FilterState.Active,
		};
	}

	const expiresAt = Object.hasOwn(patch, "expiresAt")
		? patch.expiresAt
		: current.expiresAt;
	if (!expiresAt) {
		throw new BadRequestError(
			"A Temporary filter needs expiresAt — pick a date, or switch scope to Standing.",
		);
	}

	const ttl = deriveFilterTtl(scope, expiresAt);
	const state =
		new Date(expiresAt).getTime() > Date.now()
			? FilterState.Active
			: FilterState.Expired;

	return { scope, expiresAt, ttl, state };
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
	actionChangedAt: item.actionChangedAt,
	matchOperator: item.matchOperator,
	literalClauses: item.literalClauses,
	actionLabelId: item.actionLabelId,
	actionMailboxId: item.actionMailboxId,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

/**
 * Create a filter, wiring the semantic anchor when `anchorMessageId` is set
 * (RFC 034 Decision 2). The anchor is built first, then the `Filter` row and
 * its sibling `FilterAnchor` row are written together in one transaction
 * (#351) — never as two independent writes a partial failure could split. A
 * message with no indexed chunks yields no anchor: the filter is created as
 * purely literal (`hasAnchor: false`) rather than with an empty anchor.
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

	return deps.filterAnchorTransaction.createWithAnchor(
		{
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
		},
		anchor && anchorMessageId
			? {
					accountConfigId,
					anchorMessageId,
					anchorEmbedding: anchor.anchorEmbedding,
					anchorEmbeddingId: anchor.anchorEmbeddingId,
					anchorSourceText: anchor.anchorSourceText,
				}
			: null,
	);
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
				filterAnchorTransaction: client.filterAnchorTransaction,
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
		const body = context.request.requestBody as Record<string, unknown>;
		rejectAnchorMutation(body);

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const { filter } = client;
		const patch = pickFilterUpdate(body as Partial<UpdateFilterRequestBody>);
		const touchesScopeOrExpiry =
			Object.hasOwn(patch, "scope") || Object.hasOwn(patch, "expiresAt");
		const resolvedPatch: Partial<UpdateFilterInput> = touchesScopeOrExpiry
			? {
					...patch,
					...resolveFilterScopeExpiry(
						await filter.get(accountConfigId, filterId),
						patch,
					),
				}
			: patch;

		const updated = await filter.update(
			accountConfigId,
			filterId,
			resolvedPatch,
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
