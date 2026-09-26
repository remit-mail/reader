import { readConfigDocument } from "@remit/config-format";
import {
	type ConfigImportItem,
	type ConfigImportUnresolvedRefItem,
	type CreateMailboxResult,
	FILTER_NO_ACTION,
	type FilterItem,
	type IAccountSettingRepository,
	type IConfigImportRepository,
	type IFilterRepository,
	type IMailboxRepository,
	type MailboxItem,
} from "@remit/data-ports";
import { composeSettingName } from "@remit/data-ports/account-settings";
import {
	AccountSettingName,
	ConfigImportRefKind,
	ConfigImportState,
	FilterDisabledReason,
	FilterState,
	MailboxSyncStatus,
} from "@remit/domain-enums";
import type { AppointFolderRole } from "./import-repositories.js";

export interface ConfigBinderRepositories {
	configImport: Pick<IConfigImportRepository, "listByAccountConfig" | "update">;
	accountSetting: Pick<IAccountSettingRepository, "upsert">;
	filter: Pick<IFilterRepository, "listByAccountConfig" | "update">;
	mailbox: Pick<IMailboxRepository, "listAllByAccount" | "resolveAccountId">;
}

export type CreateImportedFolder = (
	accountId: string,
	folderPath: string,
) => Promise<CreateMailboxResult>;

export interface ConfigBinderDeps {
	repositories: ConfigBinderRepositories;
	appointFolderRole: AppointFolderRole;
	createFolder: CreateImportedFolder;
	now?: () => number;
}

/**
 * What one folder path an import was waiting for is still waiting for, told as
 * a count so a caller can log it without walking the refs again.
 */
export interface BindResult {
	bound: number;
	dropped: number;
	created: number;
	disabled: number;
	stillPending: number;
}

type RefState =
	| { kind: "TargetGone" }
	| { kind: "Waiting"; mailboxId: string }
	| { kind: "Ready"; mailboxId: string }
	| { kind: "Absent" }
	| { kind: "Refused"; reason: FilterItem["disabledReason"] };

/**
 * Bind the folder references an import could not resolve, now that discovery
 * has produced this account's mailboxes.
 *
 * Every reference names a folder by IMAP path, because the ids are new on every
 * discovery. A path discovery did not produce is a folder the account lacks,
 * so the binder creates it through the folder-create mutation and waits for
 * the server to confirm it (imap-mutations R1, R2: wait), binding to that row
 * by id because the server may have normalized its path. A create the server
 * refused, or a created folder that vanished, drops the reference and turns
 * its filter off with the reason.
 *
 * Idempotent and replayable: every write is an upsert or an update onto a row
 * the import already created, and a create is recorded on the reference before
 * the next run, so a second discovery finds nothing to do rather than doing it
 * again differently.
 */
export const bindImportedFolders = async (
	deps: ConfigBinderDeps,
	accountConfigId: string,
	accountId: string,
): Promise<BindResult> => {
	const { repositories } = deps;
	const now = deps.now ?? Date.now;
	const result: BindResult = {
		bound: 0,
		dropped: 0,
		created: 0,
		disabled: 0,
		stillPending: 0,
	};

	const imports = (
		await repositories.configImport.listByAccountConfig(accountConfigId)
	).filter((row) => row.state === ConfigImportState.Pending);
	if (imports.length === 0) return result;

	const mailboxes = await repositories.mailbox.listAllByAccount(accountId);
	const byPath = new Map(
		mailboxes.map((mailbox) => [mailbox.fullPath, mailbox] as const),
	);
	const byId = new Map(
		mailboxes.map((mailbox) => [mailbox.mailboxId, mailbox] as const),
	);

	const filtersById = new Map(
		(await repositories.filter.listByAccountConfig(accountConfigId)).map(
			(filter) => [filter.filterId, filter] as const,
		),
	);

	const createdByPath = new Map<string, string>();
	const createFolder = async (folderPath: string): Promise<string> => {
		const held = createdByPath.get(folderPath);
		if (held !== undefined) return held;
		const created = await deps.createFolder(accountId, folderPath);
		if (created.outcome === "PathTaken") return FILTER_NO_ACTION;
		createdByPath.set(folderPath, created.mailbox.mailboxId);
		result.created++;
		return created.mailbox.mailboxId;
	};

	for (const row of imports) {
		const document = readConfigDocument(row.document);
		const remaining: ConfigImportUnresolvedRefItem[] = [];
		let changed = false;

		for (const ref of row.unresolvedRefs) {
			const state = refStateOf(ref, accountId, byPath, byId, filtersById);
			if (
				(state.kind === "Ready" || state.kind === "Refused") &&
				!movesIntoNothing(ref, filtersById)
			) {
				await settlePickedFolder(
					repositories,
					accountConfigId,
					filtersById.get(ref.target),
				);
				result.dropped++;
				changed = true;
				continue;
			}
			if (state.kind === "TargetGone") {
				result.dropped++;
				changed = true;
				continue;
			}
			if (state.kind === "Waiting") {
				if (state.mailboxId !== ref.mailboxId) changed = true;
				remaining.push({ ...ref, mailboxId: state.mailboxId });
				continue;
			}
			if (state.kind === "Absent") {
				remaining.push({
					...ref,
					mailboxId: await createFolder(ref.folderPath),
				});
				changed = true;
				continue;
			}
			if (state.kind === "Refused") {
				if (ref.kind === ConfigImportRefKind.FilterAction) {
					await repositories.filter.update(accountConfigId, ref.target, {
						state: FilterState.Disabled,
						disabledReason: state.reason,
					});
					result.disabled++;
				}
				result.dropped++;
				changed = true;
				continue;
			}
			await bindRef(
				deps,
				accountConfigId,
				ref,
				state.mailboxId,
				document,
				filtersById,
			);
			result.bound++;
			changed = true;
		}

		result.stillPending += remaining.length;
		if (!changed) continue;

		await repositories.configImport.update(row.importId, {
			unresolvedRefs: remaining,
			...(remaining.length === 0
				? { state: ConfigImportState.Complete, completedAt: now() }
				: {}),
		});
	}

	return result;
};

export const disableFiltersMissingFolders = async (
	repositories: {
		filter: Pick<IFilterRepository, "listByAccountConfig" | "update">;
		mailbox: Pick<IMailboxRepository, "resolveAccountId">;
	},
	accountConfigId: string,
): Promise<number> => {
	const filters =
		await repositories.filter.listByAccountConfig(accountConfigId);
	let disabled = 0;
	for (const filter of filters) {
		if (filter.state !== FilterState.Active) continue;
		if (filter.actionMailboxId === FILTER_NO_ACTION) continue;
		const owner = await repositories.mailbox.resolveAccountId(
			filter.actionMailboxId,
		);
		if (owner !== null) continue;
		await repositories.filter.update(accountConfigId, filter.filterId, {
			state: FilterState.Disabled,
			disabledReason: FilterDisabledReason.FolderMissing,
		});
		disabled++;
	}
	return disabled;
};

type BoundDocument = ReturnType<typeof readConfigDocument>;

const FOLDERLESS_REASONS: ReadonlySet<FilterItem["disabledReason"]> = new Set([
	FilterDisabledReason.AwaitingFolder,
	FilterDisabledReason.FolderCreateFailed,
]);

const settlePickedFolder = async (
	repositories: ConfigBinderRepositories,
	accountConfigId: string,
	filter: FilterItem | undefined,
): Promise<void> => {
	if (!filter || filter.state !== FilterState.Disabled) return;
	if (!FOLDERLESS_REASONS.has(filter.disabledReason)) return;
	await repositories.filter.update(accountConfigId, filter.filterId, {
		disabledReason: FilterDisabledReason.UserDisabled,
	});
};

const movesIntoNothing = (
	ref: ConfigImportUnresolvedRefItem,
	filtersById: ReadonlyMap<string, FilterItem>,
): boolean =>
	ref.kind !== ConfigImportRefKind.FilterAction ||
	filtersById.get(ref.target)?.actionMailboxId === FILTER_NO_ACTION;

const findByPath = (
	folderPath: string,
	byPath: ReadonlyMap<string, MailboxItem>,
): MailboxItem | undefined => {
	const exact = byPath.get(folderPath);
	if (exact) return exact;
	const prefix = byPath.get("INBOX")?.namespacePrefix ?? "";
	if (prefix === "" || folderPath.startsWith(prefix)) return undefined;
	return byPath.get(`${prefix}${folderPath}`);
};

const refStateOf = (
	ref: ConfigImportUnresolvedRefItem,
	accountId: string,
	byPath: ReadonlyMap<string, MailboxItem>,
	byId: ReadonlyMap<string, MailboxItem>,
	filtersById: ReadonlyMap<string, FilterItem>,
): RefState => {
	if (
		ref.kind === ConfigImportRefKind.FilterAction &&
		!filtersById.has(ref.target)
	) {
		return { kind: "TargetGone" };
	}
	if (ref.accountId !== accountId) {
		return { kind: "Waiting", mailboxId: ref.mailboxId };
	}
	const created = byId.get(ref.mailboxId);
	if (created) {
		if (created.syncStatus === MailboxSyncStatus.synced) {
			return { kind: "Ready", mailboxId: created.mailboxId };
		}
		if (
			created.syncStatus === MailboxSyncStatus.failed &&
			created.pendingPath === undefined
		) {
			return {
				kind: "Refused",
				reason: FilterDisabledReason.FolderCreateFailed,
			};
		}
		return { kind: "Waiting", mailboxId: created.mailboxId };
	}
	const found = findByPath(ref.folderPath, byPath);
	if (found?.syncStatus === MailboxSyncStatus.synced) {
		return { kind: "Ready", mailboxId: found.mailboxId };
	}
	if (found) return { kind: "Waiting", mailboxId: FILTER_NO_ACTION };
	if (ref.mailboxId !== FILTER_NO_ACTION) {
		return {
			kind: "Refused",
			reason: FilterDisabledReason.FolderCreateFailed,
		};
	}
	return { kind: "Absent" };
};

const bindRef = async (
	deps: ConfigBinderDeps,
	accountConfigId: string,
	ref: ConfigImportUnresolvedRefItem,
	mailboxId: string,
	document: BoundDocument,
	filtersById: ReadonlyMap<string, FilterItem>,
): Promise<void> => {
	const { repositories } = deps;
	if (ref.kind === ConfigImportRefKind.FilterAction) {
		const awaiting =
			filtersById.get(ref.target)?.disabledReason ===
			FilterDisabledReason.AwaitingFolder;
		await repositories.filter.update(accountConfigId, ref.target, {
			actionMailboxId: mailboxId,
			...(awaiting
				? {
						state: FilterState.Active,
						disabledReason: FilterDisabledReason.None,
					}
				: {}),
		});
		return;
	}

	if (ref.kind === ConfigImportRefKind.FolderRole) {
		await deps.appointFolderRole(
			accountConfigId,
			ref.accountId,
			ref.target,
			mailboxId,
			ref.folderPath,
		);
		return;
	}

	// The account the file named, when this instance still holds it under that
	// id — it does for every account the import created, because the id crosses
	// verbatim. A merge onto an account already here can have renumbered it, and
	// then the path is the only thing left to match on.
	const named = document.accounts.find(
		(account) => account.accountId === ref.accountId,
	);
	const override = (
		named
			? named.folderOverrides
			: document.accounts.flatMap((a) => a.folderOverrides)
	).find((candidate) => candidate.folderPath === ref.folderPath);
	if (!override) return;

	if (override.displayName !== "") {
		await repositories.accountSetting.upsert({
			accountConfigId,
			name: composeSettingName(
				AccountSettingName.MailboxDisplayName,
				mailboxId,
			),
			value: { kind: "String", value: override.displayName },
		});
	}
	if (override.muted !== null) {
		await repositories.accountSetting.upsert({
			accountConfigId,
			name: composeSettingName(AccountSettingName.MailboxMuted, mailboxId),
			value: { kind: "MutedFlag", value: override.muted },
		});
	}
};

/**
 * The folder paths an import is still waiting on, for `GET /config`. The newest
 * pending import only: an older one waiting for the same folder is waiting for
 * the same thing, and naming it twice tells nobody anything.
 */
export const pendingImportOf = (
	imports: readonly ConfigImportItem[],
): { importId: string; folderPaths: string[] } | undefined => {
	const pending = imports
		.filter((row) => row.state === ConfigImportState.Pending)
		.sort((a, b) => b.createdAt - a.createdAt)[0];
	if (!pending || pending.unresolvedRefs.length === 0) return undefined;
	return {
		importId: pending.importId,
		folderPaths: [
			...new Set(pending.unresolvedRefs.map((ref) => ref.folderPath)),
		],
	};
};
