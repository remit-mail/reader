import type {
	AccountItem,
	IAccountRepository,
	ILabelMailboxRepository,
	ILabelRepository,
	IMailboxRepository,
	LabelItem,
	LabelMailboxItem,
	MailboxItem,
} from "@remit/data-ports";
import { isReservedFolderName } from "@remit/data-ports/folder-role";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { MailboxQueueService } from "./mailbox-queue.js";
import { accept, invalid, type Refusable } from "./refusal.js";
import {
	discoverRemitRoot,
	generateRemitRootName,
	type RemitRootLogger,
} from "./remit-root.js";

export type LabelFolderState = "Present" | "Pending" | "Missing";

export type LabelFolder =
	| {
			accountId: string;
			state: "Present" | "Pending";
			mailboxId: string;
			fullPath: string;
	  }
	| { accountId: string; state: "Missing" };

export interface LabelWithFolders {
	label: LabelItem;
	folders: LabelFolder[];
}

export interface RemitRootDeps {
	mailbox: Pick<IMailboxRepository, "findByPath">;
	mailboxQueue: Pick<MailboxQueueService, "createMailbox">;
	log: RemitRootLogger;
}

export interface LabelFolderReadDeps {
	account: Pick<IAccountRepository, "listMailSourcesByAccountConfig">;
	mailbox: Pick<IMailboxRepository, "listAllByAccount">;
	label: Pick<ILabelRepository, "listByAccountConfig">;
	labelMailbox: Pick<ILabelMailboxRepository, "listByAccount">;
}

export interface CreateLabelDeps extends RemitRootDeps {
	account: Pick<IAccountRepository, "listMailSourcesByAccountConfig">;
	mailbox: Pick<IMailboxRepository, "findByPath" | "listAllByAccount">;
	label: Pick<ILabelRepository, "create" | "findByNormalizedName">;
	labelMailbox: Pick<ILabelMailboxRepository, "get" | "put">;
}

export interface AdoptLabelFolderDeps {
	label: Pick<ILabelRepository, "listByAccountConfig">;
	labelMailbox: Pick<ILabelMailboxRepository, "listByAccount" | "put">;
}

export interface NewLabel {
	name: string;
	color?: LabelItem["color"];
}

const foldName = (name: string): string => name.trim().toLowerCase();

const byFoldedNameThenId = (
	left: Pick<LabelItem, "normalizedName" | "labelId">,
	right: Pick<LabelItem, "normalizedName" | "labelId">,
): number =>
	left.normalizedName.localeCompare(right.normalizedName) ||
	left.labelId.localeCompare(right.labelId);

const isInbox = (mailbox: Pick<MailboxItem, "fullPath">): boolean =>
	mailbox.fullPath.toUpperCase() === "INBOX";

export const labelFolderOf = (
	accountId: string,
	mailbox: MailboxItem | undefined,
): LabelFolder => {
	if (mailbox === undefined) {
		return { accountId, state: "Missing" };
	}
	const { mailboxId, fullPath } = mailbox;
	if (mailbox.syncStatus === MailboxSyncStatus.synced) {
		return { accountId, state: "Present", mailboxId, fullPath };
	}
	if (mailbox.syncStatus === MailboxSyncStatus.pending) {
		return { accountId, state: "Pending", mailboxId, fullPath };
	}
	return { accountId, state: "Missing" };
};

const childName = (
	root: Pick<MailboxItem, "fullPath" | "hierarchyDelimiter">,
	mailbox: Pick<MailboxItem, "fullPath">,
): string | undefined => {
	const head = `${root.fullPath}${root.hierarchyDelimiter}`;
	if (!mailbox.fullPath.startsWith(head)) return undefined;
	const name = mailbox.fullPath.slice(head.length);
	if (name === "" || name.includes(root.hierarchyDelimiter)) return undefined;
	return name;
};

export const remitRootChildren = (
	root: Pick<MailboxItem, "fullPath" | "hierarchyDelimiter">,
	mailboxes: readonly MailboxItem[],
): { name: string; mailbox: MailboxItem }[] =>
	mailboxes.flatMap((mailbox) => {
		const name = childName(root, mailbox);
		return name === undefined ? [] : [{ name, mailbox }];
	});

const queueFolder = async (
	deps: RemitRootDeps,
	template: MailboxItem,
	fullPath: string,
): Promise<MailboxItem> => {
	const created = await deps.mailboxQueue.createMailbox(
		{
			accountId: template.accountId,
			namespaceType: template.namespaceType,
			namespacePrefix: template.namespacePrefix,
			hierarchyDelimiter: template.hierarchyDelimiter,
			fullPath,
			uidValidity: 0,
			uidNext: 1,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
		},
		template.accountId,
		true,
	);
	if (created.outcome === "Created") return created.mailbox;
	const existing = await deps.mailbox.findByPath(template.accountId, fullPath);
	if (!existing) {
		throw new Error(
			`No folder at "${fullPath}" after its create reported the path taken`,
		);
	}
	return existing;
};

export const ensureRemitRoot = async (
	deps: RemitRootDeps,
	mailboxes: readonly MailboxItem[],
): Promise<MailboxItem | undefined> => {
	const found = discoverRemitRoot(mailboxes, deps.log);
	if (found) return found;
	const inbox = mailboxes.find(isInbox);
	if (!inbox || inbox.hierarchyDelimiter === "") return undefined;
	return queueFolder(
		deps,
		inbox,
		`${inbox.fullPath}${inbox.hierarchyDelimiter}${generateRemitRootName()}`,
	);
};

const labelNameRefusal = (
	name: string,
	delimiters: ReadonlySet<string>,
): Refusable<string> => {
	const trimmed = name.trim();
	if (trimmed === "") return invalid("A label needs a name.");
	for (const delimiter of delimiters) {
		if (trimmed.includes(delimiter)) {
			return invalid(
				`A label name can't contain “${delimiter}”, which separates folders on the mail server.`,
			);
		}
	}
	if (isReservedFolderName(trimmed)) {
		return invalid(
			`“${trimmed}” is reserved for a system folder. Pick another name.`,
		);
	}
	return accept(trimmed);
};

const ensureLabelFolder = async (
	deps: CreateLabelDeps,
	label: LabelItem,
	account: Pick<AccountItem, "accountId">,
	mailboxes: readonly MailboxItem[],
): Promise<LabelFolder> => {
	const { accountId } = account;
	const mapped = await deps.labelMailbox.get(label.labelId, accountId);
	const mappedFolder = labelFolderOf(
		accountId,
		mailboxes.find((mailbox) => mailbox.mailboxId === mapped?.mailboxId),
	);
	if (mappedFolder.state !== "Missing") return mappedFolder;

	const root = await ensureRemitRoot(deps, mailboxes);
	if (!root) return mappedFolder;

	const adopted = remitRootChildren(root, mailboxes).find(
		(child) => foldName(child.name) === label.normalizedName,
	);
	const folder =
		adopted?.mailbox ??
		(await queueFolder(
			deps,
			root,
			`${root.fullPath}${root.hierarchyDelimiter}${label.name.trim()}`,
		));
	await deps.labelMailbox.put({
		labelId: label.labelId,
		accountId,
		mailboxId: folder.mailboxId,
	});
	return labelFolderOf(accountId, folder);
};

const liveMailSources = async (
	deps: Pick<CreateLabelDeps, "account">,
	accountConfigId: string,
): Promise<AccountItem[]> =>
	(await deps.account.listMailSourcesByAccountConfig(accountConfigId)).filter(
		(account) => account.deletedAt === undefined,
	);

export const createLabelWithFolders = async (
	deps: CreateLabelDeps,
	accountConfigId: string,
	input: NewLabel,
): Promise<Refusable<LabelWithFolders>> => {
	const accounts = await liveMailSources(deps, accountConfigId);
	const mailboxesByAccount = await Promise.all(
		accounts.map((account) => deps.mailbox.listAllByAccount(account.accountId)),
	);
	const delimiters = new Set(
		mailboxesByAccount
			.flat()
			.filter(isInbox)
			.map((inbox) => inbox.hierarchyDelimiter)
			.filter((delimiter) => delimiter !== ""),
	);
	const name = labelNameRefusal(input.name, delimiters);
	if (!name.ok) return name;

	const label =
		(await deps.label.findByNormalizedName(accountConfigId, name.value)) ??
		(await deps.label.create({
			accountConfigId,
			name: name.value,
			color: input.color,
		}));

	const folders: LabelFolder[] = [];
	for (const [index, account] of accounts.entries()) {
		folders.push(
			await ensureLabelFolder(
				deps,
				label,
				account,
				mailboxesByAccount[index] ?? [],
			),
		);
	}
	return accept({ label, folders });
};

export const listLabelsWithFolders = async (
	deps: LabelFolderReadDeps,
	accountConfigId: string,
): Promise<LabelWithFolders[]> => {
	const [labels, accounts] = await Promise.all([
		deps.label.listByAccountConfig(accountConfigId),
		liveMailSources(deps, accountConfigId),
	]);
	const perAccount = await Promise.all(
		accounts.map(async (account) => {
			const [mailboxes, mappings] = await Promise.all([
				deps.mailbox.listAllByAccount(account.accountId),
				deps.labelMailbox.listByAccount(account.accountId),
			]);
			const mailboxById = new Map(
				mailboxes.map((mailbox) => [mailbox.mailboxId, mailbox]),
			);
			const mailboxIdByLabel = new Map(
				mappings.map((mapping) => [mapping.labelId, mapping.mailboxId]),
			);
			return { accountId: account.accountId, mailboxById, mailboxIdByLabel };
		}),
	);
	return [...labels].sort(byFoldedNameThenId).map((label) => ({
		label,
		folders: perAccount.map(({ accountId, mailboxById, mailboxIdByLabel }) => {
			const mailboxId = mailboxIdByLabel.get(label.labelId);
			return labelFolderOf(
				accountId,
				mailboxId === undefined ? undefined : mailboxById.get(mailboxId),
			);
		}),
	}));
};

export const adoptLabelFolders = async (
	deps: AdoptLabelFolderDeps,
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	root: MailboxItem,
	mailboxes: readonly MailboxItem[],
): Promise<LabelMailboxItem[]> => {
	const children = remitRootChildren(root, mailboxes);
	if (children.length === 0) return [];
	const [labels, mappings] = await Promise.all([
		deps.label.listByAccountConfig(account.accountConfigId),
		deps.labelMailbox.listByAccount(account.accountId),
	]);
	const present = new Set(mailboxes.map((mailbox) => mailbox.mailboxId));
	const mapped = new Set(
		mappings
			.filter((mapping) => present.has(mapping.mailboxId))
			.map((mapping) => mapping.labelId),
	);
	const adopted: LabelMailboxItem[] = [];
	for (const label of [...labels].sort(byFoldedNameThenId)) {
		if (mapped.has(label.labelId)) continue;
		const child = children.find(
			({ name }) => foldName(name) === label.normalizedName,
		);
		if (!child) continue;
		adopted.push(
			await deps.labelMailbox.put({
				labelId: label.labelId,
				accountId: account.accountId,
				mailboxId: child.mailbox.mailboxId,
			}),
		);
	}
	return adopted;
};

export const reconcileRemitFolders = async (
	deps: RemitRootDeps & AdoptLabelFolderDeps,
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	mailboxes: readonly MailboxItem[],
): Promise<LabelMailboxItem[]> => {
	const root = await ensureRemitRoot(deps, mailboxes);
	if (!root) return [];
	return adoptLabelFolders(deps, account, root, mailboxes);
};
