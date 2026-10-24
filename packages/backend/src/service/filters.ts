import type {
	CreateFilterInput,
	CreateFilterResponse,
	FilterResponse,
	UpdateFilterInput as UpdateFilterRequestBody,
} from "@remit/api-openapi-types";
import {
	deriveFilterTtl,
	FILTER_NO_ACTION,
	type FilterItem,
	type IMailboxRepository,
	type UpdateFilterInput,
} from "@remit/data-ports";
import {
	FilterDisabledReason,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import type { AuthenticatedUser } from "../auth.js";
import type { RemitClient } from "./data-client.js";
import {
	accountOwnershipRefusal,
	mailboxInAccountRefusal,
	mailboxSettledRefusal,
} from "./guards.js";
import { queueOrganizeJob } from "./organize-queue.js";
import { invalid, type Outcome, ok, type Refusal, refuse } from "./outcome.js";

/**
 * Reduce a PATCH body to the fields a filter update may set (RFC 034, reader
 * #266). Preserves absence: a key not present in the body is not present in
 * the patch, so a name-only rename yields `{ name }` and never touches a
 * predicate/action/scope/expiresAt field — the service's
 * `changesRuleAssertion` guard then leaves `ruleChangedAt` untouched (Decision
 * 3.2). Any field outside this set — most notably a server-derived
 * `state`/`ttl`/`ruleChangedAt` smuggled into the body — is
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
	if (Object.hasOwn(body, "state")) patch.state = body.state;
	return patch;
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
 * `Temporary` without one is refused, matching the Filter model's invariant
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
): Outcome<ResolvedScopeExpiry> => {
	const scope = patch.scope ?? current.scope;

	if (scope !== FilterScope.Temporary) {
		if (Object.hasOwn(patch, "expiresAt") && patch.expiresAt) {
			return refuse(
				invalid(
					"expiresAt only applies to a Temporary filter — switch scope to Temporary to set one.",
				),
			);
		}
		return ok({
			scope,
			expiresAt: undefined,
			ttl: undefined,
			state: FilterState.Active,
		});
	}

	const expiresAt = Object.hasOwn(patch, "expiresAt")
		? patch.expiresAt
		: current.expiresAt;
	if (!expiresAt) {
		return refuse(
			invalid(
				"A Temporary filter needs expiresAt — pick a date, or switch scope to Standing.",
			),
		);
	}

	const ttl = deriveFilterTtl(scope, expiresAt);
	const state =
		new Date(expiresAt).getTime() > Date.now()
			? FilterState.Active
			: FilterState.Expired;

	return ok({ scope, expiresAt, ttl, state });
};

const hasLapsed = (
	filter: Pick<FilterItem, "scope" | "expiresAt">,
	now: number,
): boolean =>
	filter.scope === FilterScope.Temporary &&
	filter.expiresAt !== undefined &&
	new Date(filter.expiresAt).getTime() <= now;

const FOLDERLESS_REASONS: ReadonlySet<FilterItem["disabledReason"]> = new Set([
	FilterDisabledReason.AwaitingFolder,
	FilterDisabledReason.FolderCreateFailed,
]);

const folderlessRefusal = (reason: FilterItem["disabledReason"]): Refusal =>
	invalid(
		reason === FilterDisabledReason.AwaitingFolder
			? "This filter has no folder to move mail into yet. Wait for its folder to be created on the mail server, or pick a folder in the rule, then turn it on."
			: "The mail server refused to create this filter's folder. Pick a folder in the rule, then turn it on.",
	);

export const resolveFilterUpdate = (
	current: Pick<
		FilterItem,
		"scope" | "expiresAt" | "state" | "disabledReason" | "actionMailboxId"
	>,
	patch: Partial<UpdateFilterInput>,
	now: number = Date.now(),
): Outcome<Partial<UpdateFilterInput>> => {
	if (patch.state === FilterState.Expired) {
		return refuse(
			invalid(
				"A filter expires through its date, not its state. Set it Active or Disabled, or change its expiry.",
			),
		);
	}
	const folderless =
		current.state === FilterState.Disabled &&
		FOLDERLESS_REASONS.has(current.disabledReason);
	const folder = patch.actionMailboxId ?? current.actionMailboxId;
	const picked = folderless && folder !== FILTER_NO_ACTION;
	const pickedReason = picked
		? { disabledReason: FilterDisabledReason.UserDisabled }
		: {};

	const touchesTiming =
		Object.hasOwn(patch, "scope") || Object.hasOwn(patch, "expiresAt");
	if (!touchesTiming && patch.state === undefined) {
		return ok({ ...patch, ...pickedReason });
	}

	let timing: ResolvedScopeExpiry | undefined;
	if (touchesTiming) {
		const resolved = resolveFilterScopeExpiry(current, patch);
		if (!resolved.ok) return resolved;
		timing = resolved.value;
	}
	const lapsed = timing
		? timing.state === FilterState.Expired
		: hasLapsed(current, now);

	if (patch.state === FilterState.Active && lapsed) {
		return refuse(
			invalid(
				"This filter has expired. Move its date forward or make it Standing to turn it back on.",
			),
		);
	}

	const wanted = patch.state ?? current.state;
	const merged = { ...patch, ...timing };
	if (wanted === FilterState.Disabled) {
		return ok({
			...merged,
			state: FilterState.Disabled,
			...(folderless
				? pickedReason
				: patch.state === FilterState.Disabled
					? { disabledReason: FilterDisabledReason.UserDisabled }
					: {}),
		});
	}
	if (lapsed) {
		return ok({
			...merged,
			state: FilterState.Expired,
			disabledReason: FilterDisabledReason.None,
		});
	}
	if (folderless && folder === FILTER_NO_ACTION) {
		return refuse(folderlessRefusal(current.disabledReason));
	}
	return ok({
		...merged,
		state: FilterState.Active,
		disabledReason: FilterDisabledReason.None,
	});
};

/**
 * A filter's `actionMailboxId` is a durable reference, so its target has to be
 * a folder the mail server has settled (D12, first row) — 422 otherwise. The
 * sentinel means "no move action" and binds to nothing, so it is not gated,
 * and neither is a filter that touches the field at all.
 */
const actionMailboxRefusal = async (
	client: { mailbox: Pick<IMailboxRepository, "get"> },
	accountId: string,
	actionMailboxId: string | undefined,
): Promise<Refusal | undefined> => {
	if (actionMailboxId === undefined || actionMailboxId === FILTER_NO_ACTION) {
		return undefined;
	}
	const target = await client.mailbox.get(accountId, actionMailboxId);
	return (
		mailboxInAccountRefusal(target, accountId, "act") ??
		mailboxSettledRefusal(target)
	);
};

const enabledTargetRefusal = async (
	client: {
		mailbox: Pick<IMailboxRepository, "get" | "resolveAccountId">;
	},
	accountId: string,
	actionMailboxId: string,
): Promise<Refusal | undefined> => {
	if (actionMailboxId === FILTER_NO_ACTION) return undefined;
	if ((await client.mailbox.resolveAccountId(actionMailboxId)) === null) {
		return invalid(
			"The folder this filter moves mail into no longer exists. Pick another folder, then turn the filter on.",
		);
	}
	return actionMailboxRefusal(client, accountId, actionMailboxId);
};

export const toFilterResponse = (item: FilterItem): FilterResponse => ({
	filterId: item.filterId,
	accountConfigId: item.accountConfigId,
	name: item.name,
	scope: item.scope,
	expiresAt: item.expiresAt,
	state: item.state,
	disabledReason: item.disabledReason,
	ruleChangedAt: item.ruleChangedAt,
	actionChangedAt: item.actionChangedAt,
	matchOperator: item.matchOperator,
	literalClauses: item.literalClauses,
	actionLabelId: item.actionLabelId,
	actionMailboxId: item.actionMailboxId,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

export interface FilterPage {
	items: FilterResponse[];
	continuationToken?: string;
}

export const listFilters = async (
	client: RemitClient,
	user: AuthenticatedUser,
	input: { accountId: string; continuationToken: string | undefined },
): Promise<Outcome<FilterPage>> => {
	const { accountConfigId } = user;
	const account = await client.account.get(input.accountId);
	const notOwned = accountOwnershipRefusal(account, accountConfigId, "read");
	if (notOwned) return refuse(notOwned);

	const { filter } = client;
	const page = await filter.listPageByAccountConfig(accountConfigId, {
		continuationToken: input.continuationToken,
	});

	// Reading the list is one of the touch points that lazily expires a past
	// Temporary filter (RFC 034 Decision 1.2) — a no-op write for Standing or
	// not-yet-expired filters.
	const items = await Promise.all(
		page.items.map((item) => filter.refreshExpiry(item)),
	);

	return ok({
		items: items.map(toFilterResponse),
		continuationToken: page.continuationToken,
	});
};

export const createFilter = async (
	client: RemitClient,
	user: AuthenticatedUser,
	input: { accountId: string; filter: CreateFilterInput },
): Promise<Outcome<CreateFilterResponse>> => {
	const { accountConfigId, userId } = user;
	const { accountId, filter: rule } = input;
	if (!userId) {
		throw new Error(
			"Missing Cognito `sub`: cannot attribute an organize job to a user",
		);
	}

	const account = await client.account.get(accountId);
	const notOwned = accountOwnershipRefusal(account, accountConfigId, "act");
	if (notOwned) return refuse(notOwned);
	const target = await actionMailboxRefusal(
		client,
		accountId,
		rule.actionMailboxId,
	);
	if (target) return refuse(target);

	const filter = await client.filter.create({
		accountConfigId,
		name: rule.name,
		scope: rule.scope,
		expiresAt: rule.expiresAt,
		ttl: deriveFilterTtl(rule.scope, rule.expiresAt),
		matchOperator: rule.matchOperator,
		literalClauses: rule.literalClauses,
		actionLabelId: rule.actionLabelId,
		actionMailboxId: rule.actionMailboxId,
	});
	// The new filter's first pass over the inbox. The worker reads the filter
	// when it runs and refuses one that has nothing to run (#1354).
	const job = await queueOrganizeJob(client, {
		accountConfigId,
		userId,
		filterId: filter.filterId,
	});
	return ok({ ...toFilterResponse(filter), organizeJobId: job.organizeJobId });
};

export const updateFilter = async (
	client: RemitClient,
	user: AuthenticatedUser,
	input: {
		accountId: string;
		filterId: string;
		patch: Partial<UpdateFilterRequestBody>;
	},
): Promise<Outcome<FilterResponse>> => {
	const { accountConfigId } = user;
	const { accountId, filterId } = input;

	const account = await client.account.get(accountId);
	const notOwned = accountOwnershipRefusal(account, accountConfigId, "act");
	if (notOwned) return refuse(notOwned);

	const { filter } = client;
	const patch = pickFilterUpdate(input.patch);
	const target = await actionMailboxRefusal(
		client,
		accountId,
		patch.actionMailboxId,
	);
	if (target) return refuse(target);
	const current = await filter.get(accountConfigId, filterId);
	const resolvedPatch = resolveFilterUpdate(current, patch);
	if (!resolvedPatch.ok) return resolvedPatch;
	if (
		patch.state === FilterState.Active &&
		patch.actionMailboxId === undefined
	) {
		const missing = await enabledTargetRefusal(
			client,
			accountId,
			current.actionMailboxId,
		);
		if (missing) return refuse(missing);
	}

	const updated = await filter.update(
		accountConfigId,
		filterId,
		resolvedPatch.value,
	);
	return ok(toFilterResponse(updated));
};
