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
	type CanonicalMailboxRoleValue,
	composeFolderRoleAppointmentName,
} from "@remit/data-ports/folder-role";
import {
	AccountSettingName,
	ConfigImportRefKind,
	ConfigImportState,
} from "@remit/domain-enums";

export interface ConfigBinderRepositories {
	configImport: Pick<IConfigImportRepository, "listByAccountConfig" | "update">;
	accountSetting: Pick<IAccountSettingRepository, "upsert">;
	filter: Pick<IFilterRepository, "update">;
	mailbox: Pick<IMailboxRepository, "listAllByAccount">;
}

export interface ConfigBinderDeps {
	repositories: ConfigBinderRepositories;
	now?: () => number;
}

/**
 * What one folder path an import was waiting for is still waiting for, told as
 * a count so a caller can log it without walking the refs again.
 */
export interface BindResult {
	bound: number;
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
	if (imports.length === 0) return { bound: 0, stillPending: 0 };

	const byPath = new Map(
		(await repositories.mailbox.listAllByAccount(accountId)).map(
			(mailbox) => [mailbox.fullPath, mailbox.mailboxId] as const,
		),
	);

	let bound = 0;
	let stillPending = 0;

	for (const row of imports) {
		const document = readConfigDocument(row.document);
		const remaining: ConfigImportUnresolvedRefItem[] = [];

		for (const ref of row.unresolvedRefs) {
			const mailboxId =
				ref.accountId === accountId ? byPath.get(ref.folderPath) : undefined;
			if (mailboxId === undefined) {
				remaining.push(ref);
				continue;
			}
			await bindRef(repositories, accountConfigId, ref, mailboxId, document);
			bound++;
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

	return { bound, stillPending };
};

type BoundDocument = ReturnType<typeof readConfigDocument>;

const bindRef = async (
	repositories: ConfigBinderRepositories,
	accountConfigId: string,
	ref: ConfigImportUnresolvedRefItem,
	mailboxId: string,
	document: BoundDocument,
): Promise<void> => {
	if (ref.kind === ConfigImportRefKind.FilterAction) {
		await repositories.filter.update(accountConfigId, ref.target, {
			actionMailboxId: mailboxId,
		});
		return;
	}

	if (ref.kind === ConfigImportRefKind.FolderRole) {
		await repositories.accountSetting.upsert({
			accountConfigId,
			name: composeFolderRoleAppointmentName(
				ref.accountId,
				ref.target as CanonicalMailboxRoleValue,
			),
			value: { kind: "String", value: mailboxId },
		});
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
