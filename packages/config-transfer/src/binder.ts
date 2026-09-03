import { readConfigDocument } from "@remit/config-format";
import type {
	ConfigImportItem,
	ConfigImportUnresolvedRefItem,
	IAccountSettingRepository,
	IConfigImportRepository,
	IFilterRepository,
	IMailboxRepository,
} from "@remit/data-ports";
import { composeSettingName } from "@remit/data-ports/account-settings";
import {
	AccountSettingName,
	ConfigImportRefKind,
	ConfigImportState,
} from "@remit/domain-enums";
import type { AppointFolderRole } from "./import-repositories.js";

export interface ConfigBinderRepositories {
	configImport: Pick<IConfigImportRepository, "listByAccountConfig" | "update">;
	accountSetting: Pick<IAccountSettingRepository, "upsert">;
	filter: Pick<IFilterRepository, "listByAccountConfig" | "update">;
	mailbox: Pick<IMailboxRepository, "listAllByAccount">;
}

export interface ConfigBinderDeps {
	repositories: ConfigBinderRepositories;
	appointFolderRole: AppointFolderRole;
	now?: () => number;
}

/**
 * What one folder path an import was waiting for is still waiting for, told as
 * a count so a caller can log it without walking the refs again. `dropped` is
 * the references whose target is gone — the row they would have written no
 * longer exists, so there is nothing left to wait for.
 */
export interface BindResult {
	bound: number;
	dropped: number;
	stillPending: number;
}

/**
 * Bind the folder references an import could not resolve, now that discovery
 * has produced this account's mailboxes.
 *
 * Every reference names a folder by IMAP path, because the ids are new on every
 * discovery. This runs where discovery ends, resolves what it can, writes the
 * row each reference belongs to, and drops it. An import whose last reference
 * is gone is Complete; the rest stay, and surface on `GET /config` until the
 * folder they name shows up or the person removes the expectation.
 *
 * Removing the expectation means deleting the filter, and a reference to a
 * filter that is gone is dropped rather than retried: the row it would write
 * does not exist, and a reference that cannot ever resolve would otherwise be
 * carried, and re-attempted, on every discovery for the life of the account.
 *
 * Idempotent and replayable: every write is an upsert or an update onto a row
 * the import already created, so a second discovery finds nothing to do rather
 * than doing it again differently.
 */
export const bindImportedFolders = async (
	deps: ConfigBinderDeps,
	accountConfigId: string,
	accountId: string,
): Promise<BindResult> => {
	const { repositories } = deps;
	const now = deps.now ?? Date.now;

	const imports = (
		await repositories.configImport.listByAccountConfig(accountConfigId)
	).filter((row) => row.state === ConfigImportState.Pending);
	if (imports.length === 0) return { bound: 0, dropped: 0, stillPending: 0 };

	const byPath = new Map(
		(await repositories.mailbox.listAllByAccount(accountId)).map(
			(mailbox) => [mailbox.fullPath, mailbox.mailboxId] as const,
		),
	);

	const context: BindContext = {
		accountConfigId,
		accountId,
		mailboxIdByPath: byPath,
		filterIds: filterIdReader(repositories, accountConfigId),
	};

	let bound = 0;
	let dropped = 0;
	let stillPending = 0;

	for (const row of imports) {
		const document = readConfigDocument(row.document);
		const remaining: ConfigImportUnresolvedRefItem[] = [];

		for (const ref of row.unresolvedRefs) {
			const outcome = await bindRef(deps, context, ref, document);
			if (outcome === "StillPending") {
				remaining.push(ref);
				continue;
			}
			if (outcome === "TargetGone") dropped++;
			else bound++;
		}

		stillPending += remaining.length;
		if (remaining.length === row.unresolvedRefs.length) continue;

		await repositories.configImport.update(row.importId, {
			unresolvedRefs: remaining,
			...(remaining.length === 0
				? { state: ConfigImportState.Complete, completedAt: now() }
				: {}),
		});
	}

	return { bound, dropped, stillPending };
};

type BoundDocument = ReturnType<typeof readConfigDocument>;

/**
 * What became of one reference. Every outcome is a designed one: the folder is
 * here and the row was written, the row the reference names is gone, or the
 * folder has still not been discovered.
 */
type RefOutcome = "Bound" | "TargetGone" | "StillPending";

interface BindContext {
	accountConfigId: string;
	accountId: string;
	mailboxIdByPath: ReadonlyMap<string, string>;
	filterIds: () => Promise<ReadonlySet<string>>;
}

/**
 * Which filters this configuration still holds, read once per bind run and only
 * if a reference actually reaches a filter. A list is the read that answers
 * "is it gone" without a throw — `IFilterRepository` has no other.
 */
const filterIdReader = (
	repositories: ConfigBinderRepositories,
	accountConfigId: string,
): (() => Promise<ReadonlySet<string>>) => {
	let held: Promise<ReadonlySet<string>> | undefined;
	return () => {
		held ??= repositories.filter
			.listByAccountConfig(accountConfigId)
			.then((filters) => new Set(filters.map((filter) => filter.filterId)));
		return held;
	};
};

const bindRef = async (
	deps: ConfigBinderDeps,
	context: BindContext,
	ref: ConfigImportUnresolvedRefItem,
	document: BoundDocument,
): Promise<RefOutcome> => {
	const { repositories } = deps;
	const mailboxId =
		ref.accountId === context.accountId
			? context.mailboxIdByPath.get(ref.folderPath)
			: undefined;
	if (mailboxId === undefined) return "StillPending";

	if (ref.kind === ConfigImportRefKind.FilterAction) {
		if (!(await context.filterIds()).has(ref.target)) return "TargetGone";
		await repositories.filter.update(context.accountConfigId, ref.target, {
			actionMailboxId: mailboxId,
		});
		return "Bound";
	}

	if (ref.kind === ConfigImportRefKind.FolderRole) {
		await deps.appointFolderRole(
			context.accountConfigId,
			ref.accountId,
			ref.target,
			mailboxId,
			ref.folderPath,
		);
		return "Bound";
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
	if (!override) return "TargetGone";

	if (override.displayName !== "") {
		await repositories.accountSetting.upsert({
			accountConfigId: context.accountConfigId,
			name: composeSettingName(
				AccountSettingName.MailboxDisplayName,
				mailboxId,
			),
			value: { kind: "String", value: override.displayName },
		});
	}
	if (override.muted !== null) {
		await repositories.accountSetting.upsert({
			accountConfigId: context.accountConfigId,
			name: composeSettingName(AccountSettingName.MailboxMuted, mailboxId),
			value: { kind: "MutedFlag", value: override.muted },
		});
	}
	return "Bound";
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
