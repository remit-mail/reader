import {
	deriveFilterTtl,
	FILTER_NO_ACTION,
	type FilterItem,
	type IAccountRepository,
	type IFilterRepository,
	type IMailboxRepository,
	type MailboxItem,
	type OrganizeJobRequestItem,
	type UpdateFilterInput,
} from "@remit/data-ports";
import {
	FilterDisabledReason,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import {
	type OrganizeJobDeps,
	type OrganizeJobOwner,
	queueOrganizeJob,
} from "./organize-job.js";
import { folderInAccount, ownedAccount, settledFolder } from "./ownership.js";
import { accept, invalid, type Refusable } from "./refusal.js";

export type NewFilter = Pick<
	FilterItem,
	| "name"
	| "scope"
	| "expiresAt"
	| "matchOperator"
	| "literalClauses"
	| "actionLabelId"
	| "actionMailboxId"
>;

export type FilterPatch = Pick<
	UpdateFilterInput,
	| "name"
	| "scope"
	| "expiresAt"
	| "matchOperator"
	| "literalClauses"
	| "actionLabelId"
	| "actionMailboxId"
	| "state"
>;

interface ResolvedScopeExpiry {
	scope: FilterItem["scope"];
	expiresAt?: string;
	ttl?: number;
	state: FilterItem["state"];
}

export interface FilterPage {
	items: FilterItem[];
	continuationToken?: string;
}

export interface CreatedFilter {
	filter: FilterItem;
	organizeJob: OrganizeJobRequestItem;
}

interface AccountDeps {
	account: Pick<IAccountRepository, "get">;
}

interface ActionFolderDeps {
	mailbox: Pick<IMailboxRepository, "resolveAccountId"> & {
		get(accountId: string, mailboxId: string): Promise<MailboxItem>;
	};
}

// Only these keys reach the repo, and a key absent from the body stays absent,
// so a rename never bumps ruleChangedAt and a smuggled ttl is dropped.
const pickFilterUpdate = (body: FilterPatch): FilterPatch => {
	const patch: FilterPatch = {};
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

// A Temporary filter always carries expiresAt; outside Temporary both
// expiresAt and the table-wide ttl stay absent, or the row would be swept.
const resolveFilterScopeExpiry = (
	current: Pick<FilterItem, "scope" | "expiresAt">,
	patch: FilterPatch,
): Refusable<ResolvedScopeExpiry> => {
	const scope = patch.scope ?? current.scope;

	if (scope !== FilterScope.Temporary) {
		if (Object.hasOwn(patch, "expiresAt") && patch.expiresAt) {
			return invalid(
				"expiresAt only applies to a Temporary filter — switch scope to Temporary to set one.",
			);
		}
		return accept({
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
		return invalid(
			"A Temporary filter needs expiresAt — pick a date, or switch scope to Standing.",
		);
	}

	const ttl = deriveFilterTtl(scope, expiresAt);
	const state =
		new Date(expiresAt).getTime() > Date.now()
			? FilterState.Active
			: FilterState.Expired;

	return accept({ scope, expiresAt, ttl, state });
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

const folderlessMessage = (reason: FilterItem["disabledReason"]): string =>
	reason === FilterDisabledReason.AwaitingFolder
		? "This filter has no folder to move mail into yet. Wait for its folder to be created on the mail server, or pick a folder in the rule, then turn it on."
		: "The mail server refused to create this filter's folder. Pick a folder in the rule, then turn it on.";

export const resolveFilterUpdate = (
	current: Pick<
		FilterItem,
		"scope" | "expiresAt" | "state" | "disabledReason" | "actionMailboxId"
	>,
	patch: FilterPatch,
	now: number = Date.now(),
): Refusable<UpdateFilterInput> => {
	if (patch.state === FilterState.Expired) {
		return invalid(
			"A filter expires through its date, not its state. Set it Active or Disabled, or change its expiry.",
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
		return accept({ ...patch, ...pickedReason });
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
		return invalid(
			"This filter has expired. Move its date forward or make it Standing to turn it back on.",
		);
	}

	const wanted = patch.state ?? current.state;
	const merged = { ...patch, ...timing };
	if (wanted === FilterState.Disabled) {
		return accept({
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
		return accept({
			...merged,
			state: FilterState.Expired,
			disabledReason: FilterDisabledReason.None,
		});
	}
	if (folderless && folder === FILTER_NO_ACTION) {
		return invalid(folderlessMessage(current.disabledReason));
	}
	return accept({
		...merged,
		state: FilterState.Active,
		disabledReason: FilterDisabledReason.None,
	});
};

// The sentinel means "no move action" and binds to nothing, so it is not
// gated, and neither is a patch that leaves the field alone.
const settledActionFolder = async (
	deps: Pick<ActionFolderDeps, "mailbox">,
	accountId: string,
	actionMailboxId: string | undefined,
): Promise<Refusable<string | undefined>> => {
	if (actionMailboxId === undefined || actionMailboxId === FILTER_NO_ACTION) {
		return accept(actionMailboxId);
	}
	const target = await deps.mailbox.get(accountId, actionMailboxId);
	const inAccount = folderInAccount(target, accountId, "act");
	if (!inAccount.ok) return inAccount;
	const settled = settledFolder(target);
	if (!settled.ok) return settled;
	return accept(actionMailboxId);
};

const existingActionFolder = async (
	deps: ActionFolderDeps,
	accountId: string,
	actionMailboxId: string,
): Promise<Refusable<string | undefined>> => {
	if (actionMailboxId === FILTER_NO_ACTION) return accept(actionMailboxId);
	if ((await deps.mailbox.resolveAccountId(actionMailboxId)) === null) {
		return invalid(
			"The folder this filter moves mail into no longer exists. Pick another folder, then turn the filter on.",
		);
	}
	return settledActionFolder(deps, accountId, actionMailboxId);
};

export const listFilters = async (
	deps: AccountDeps & {
		filter: Pick<
			IFilterRepository,
			"listPageByAccountConfig" | "refreshExpiry"
		>;
	},
	accountConfigId: string,
	query: { accountId: string; continuationToken: string | undefined },
): Promise<Refusable<FilterPage>> => {
	const owned = ownedAccount(
		await deps.account.get(query.accountId),
		accountConfigId,
		"read",
	);
	if (!owned.ok) return owned;

	const page = await deps.filter.listPageByAccountConfig(accountConfigId, {
		continuationToken: query.continuationToken,
	});
	// Reading the list lazily expires a lapsed Temporary filter.
	const items = await Promise.all(
		page.items.map((item) => deps.filter.refreshExpiry(item)),
	);
	return accept({ items, continuationToken: page.continuationToken });
};

export const createFilter = async (
	deps: AccountDeps &
		ActionFolderDeps &
		OrganizeJobDeps & { filter: Pick<IFilterRepository, "create"> },
	owner: OrganizeJobOwner,
	input: { accountId: string; filter: NewFilter },
): Promise<Refusable<CreatedFilter>> => {
	const { accountConfigId, userId } = owner;
	const { accountId, filter: rule } = input;
	const owned = ownedAccount(
		await deps.account.get(accountId),
		accountConfigId,
		"act",
	);
	if (!owned.ok) return owned;
	const scoped = resolveFilterScopeExpiry(
		{ scope: rule.scope, expiresAt: undefined },
		{ scope: rule.scope, expiresAt: rule.expiresAt },
	);
	if (!scoped.ok) return scoped;
	const target = await settledActionFolder(
		deps,
		accountId,
		rule.actionMailboxId,
	);
	if (!target.ok) return target;

	const filter = await deps.filter.create({
		accountConfigId,
		name: rule.name,
		scope: scoped.value.scope,
		expiresAt: scoped.value.expiresAt,
		ttl: scoped.value.ttl,
		matchOperator: rule.matchOperator,
		literalClauses: rule.literalClauses,
		actionLabelId: rule.actionLabelId,
		actionMailboxId: rule.actionMailboxId,
	});
	// The new filter's first pass over existing mail.
	const organizeJob = await queueOrganizeJob(deps, {
		accountConfigId,
		userId,
		filterId: filter.filterId,
	});
	return accept({ filter, organizeJob });
};

export const updateFilter = async (
	deps: AccountDeps &
		ActionFolderDeps & {
			filter: Pick<IFilterRepository, "get" | "update">;
		},
	accountConfigId: string,
	input: { accountId: string; filterId: string; patch: FilterPatch },
): Promise<Refusable<FilterItem>> => {
	const { accountId, filterId } = input;
	const owned = ownedAccount(
		await deps.account.get(accountId),
		accountConfigId,
		"act",
	);
	if (!owned.ok) return owned;

	const patch = pickFilterUpdate(input.patch);
	const target = await settledActionFolder(
		deps,
		accountId,
		patch.actionMailboxId,
	);
	if (!target.ok) return target;
	const current = await deps.filter.get(accountConfigId, filterId);
	const resolved = resolveFilterUpdate(current, patch);
	if (!resolved.ok) return resolved;
	if (
		patch.state === FilterState.Active &&
		patch.actionMailboxId === undefined
	) {
		const existing = await existingActionFolder(
			deps,
			accountId,
			current.actionMailboxId,
		);
		if (!existing.ok) return existing;
	}

	return accept(
		await deps.filter.update(accountConfigId, filterId, resolved.value),
	);
};
