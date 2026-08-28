import {
	type ConfigAccount,
	type ConfigAddressFlagsEntry,
	type ConfigFilter,
	ConfigReadError,
	type ReaderConfigDocument,
	readConfigDocument,
} from "@remit/config-format";
import {
	type AccountItem,
	type AccountSettingValue,
	type ConfigImportUnresolvedRefItem,
	deriveFilterTtl,
	type FilterItem,
	type LabelItem,
} from "@remit/data-ports";
import { composeSettingName } from "@remit/data-ports/account-settings";
import {
	type CanonicalMailboxRoleValue,
	composeFolderRoleAppointmentLabelName,
	composeFolderRoleAppointmentName,
} from "@remit/data-ports/folder-role";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	AccountSettingName,
	ConfigImportRefKind,
	ConfigImportState,
	ConnectionState,
} from "@remit/domain-enums";
import { carriesUserFlag } from "./export.js";
import type { ConfigImportDeps } from "./import-repositories.js";
import {
	type ConfigImportItemReport,
	type ConfigImportOutcome,
	type ConfigImportProblem,
	ConfigImportSection,
	ConfigImportVerdict,
} from "./report.js";

/**
 * The `<modelId>@<dimensions>` stamp an anchor carries when this deployment
 * could not embed its source text at import time. It matches no real embedder,
 * which is what makes the existing lazy repair (`refreshAnchorForEmbedder`)
 * treat the anchor as needing a fresh vector the first time it is matched —
 * the same route a model migration takes. Deliberately the same literal as
 * `UNKNOWN_CHUNK_EMBEDDING_ID` in `@remit/search-service`, which config
 * transfer cannot import without dragging the vector stack into the CLI.
 */
export const ANCHOR_EMBEDDING_PENDING = "unknown";

/** The named sentinel a Filter carries for "no action of this kind". */
const NO_ACTION = "None";

export interface ImportConfigInput {
	accountConfigId: string;
	/** Owner of a configuration this import may have to create the row for. */
	userId: string;
	document: unknown;
	mode: "validate" | "apply";
	onExisting: "abort" | "merge";
}

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * The version a document claims, read straight off the raw input. The parse
 * failed, so this is the only honest answer the report can give — and a report
 * that omitted it would leave "written by a newer reader" unexplained.
 */
const claimedVersion = (input: unknown): number => {
	if (typeof input !== "object" || input === null) return 0;
	const version = (input as { schemaVersion?: unknown }).schemaVersion;
	return typeof version === "number" ? version : 0;
};

const problem = (
	code: string,
	message: string,
	details?: Record<string, string>,
): ConfigImportProblem =>
	details ? { code, message, details } : { code, message };

const rejected = (
	schemaVersion: number,
	errors: ConfigImportProblem[],
): ConfigImportOutcome => ({
	outcome: "report",
	report: {
		valid: false,
		schemaVersion,
		applied: false,
		items: [],
		errors,
		warnings: [],
		accountsNeedingCredentials: [],
	},
});

interface ExistingConfig {
	accounts: AccountItem[];
	labels: LabelItem[];
	filters: FilterItem[];
	flaggedAddresses: number;
	addressEmails: Set<string>;
	/** accountId → its folders by IMAP path. Empty for an account that has never synced. */
	mailboxPaths: Map<string, Map<string, string>>;
}

const readExisting = async (
	deps: ConfigImportDeps,
	accountConfigId: string,
): Promise<ExistingConfig> => {
	const { repositories } = deps;
	const [accounts, labels, filters] = await Promise.all([
		repositories.account.listAllByAccountConfig(accountConfigId),
		repositories.label.listByAccountConfig(accountConfigId),
		repositories.filter.listByAccountConfig(accountConfigId),
	]);
	const live = accounts.filter((account) => account.deletedAt === undefined);

	let flaggedAddresses = 0;
	const addressEmails = new Set<string>();
	let cursor: string | undefined;
	do {
		const page = await repositories.address.listByAccountConfig({
			accountConfigId,
			cursor,
		});
		for (const address of page.items) {
			addressEmails.add(normalize(address.normalizedEmail));
			if (carriesUserFlag(address.flags)) flaggedAddresses++;
		}
		cursor = page.continuationToken;
	} while (cursor);

	const mailboxPaths = new Map(
		await Promise.all(
			live.map(
				async (account): Promise<[string, Map<string, string>]> => [
					account.accountId,
					new Map(
						(
							await repositories.mailbox.listAllByAccount(account.accountId)
						).map((mailbox) => [mailbox.fullPath, mailbox.mailboxId] as const),
					),
				],
			),
		),
	);

	return {
		accounts: live,
		labels,
		filters,
		flaggedAddresses,
		addressEmails,
		mailboxPaths,
	};
};

const firstDuplicate = (keys: readonly string[]): string | undefined => {
	const seen = new Set<string>();
	for (const key of keys) {
		if (seen.has(key)) return key;
		seen.add(key);
	}
	return undefined;
};

/**
 * Everything that makes a document unimportable, gathered before the first
 * write. One rejected item stops the whole import: half a configuration is
 * worse than none, because nothing says which half.
 */
const validateDocument = (
	document: ReaderConfigDocument,
	existing: ExistingConfig,
): ConfigImportProblem[] => {
	const errors: ConfigImportProblem[] = [];

	const duplicate = (section: string, keys: readonly string[]): void => {
		const key = firstDuplicate(keys);
		if (key === undefined) return;
		errors.push(
			problem(
				"duplicate_key",
				`Two entries in ${section} share the key "${key}". A configuration names each of these once.`,
				{ section, key },
			),
		);
	};

	duplicate(
		"accounts",
		document.accounts.map((account) => normalize(account.email)),
	);
	duplicate(
		"labels",
		document.labels.map((label) => normalize(label.name)),
	);
	duplicate(
		"filters",
		document.filters.map((filter) => normalize(filter.name)),
	);
	duplicate(
		"addressFlags",
		document.addressFlags.map((entry) => normalize(entry.normalizedEmail)),
	);

	const labelNames = new Set([
		...document.labels.map((label) => normalize(label.name)),
		...existing.labels.map((label) => normalize(label.name)),
	]);
	const accountIds = new Set([
		...document.accounts.map((account) => account.accountId),
		...existing.accounts.map((account) => account.accountId),
	]);

	for (const filter of document.filters) {
		if (
			filter.actionLabelName !== null &&
			!labelNames.has(normalize(filter.actionLabelName))
		) {
			errors.push(
				problem(
					"unknown_label",
					`Filter "${filter.name}" applies the label "${filter.actionLabelName}", which this file does not carry and this configuration does not hold.`,
					{ filter: filter.name, label: filter.actionLabelName },
				),
			);
		}
		if (
			filter.actionFolder !== null &&
			!accountIds.has(filter.actionFolder.accountId)
		) {
			errors.push(
				problem(
					"unknown_account",
					`Filter "${filter.name}" files mail into a folder on an account this file does not carry.`,
					{ filter: filter.name, accountId: filter.actionFolder.accountId },
				),
			);
		}
	}

	return errors;
};

/** Which credential an imported account needs before it can sync again. */
const landingState = (
	account: ConfigAccount,
): AccountItem["connectionState"] =>
	account.credentials.required === "oauth"
		? ConnectionState.ReauthRequired
		: ConnectionState.CredentialsMissing;

interface ApplyResult {
	items: ConfigImportItemReport[];
	warnings: ConfigImportProblem[];
	accountsNeedingCredentials: string[];
	unresolvedRefs: ConfigImportUnresolvedRefItem[];
	importId: string;
}

/**
 * A write that failed after validation. It carries the item it stopped on so
 * the report can name it: the import is atomic, so nothing landed, and where it
 * stopped is the only fact worth recovering from.
 */
class ImportWriteError extends Error {
	constructor(
		readonly section: ConfigImportItemReport["section"],
		readonly key: string,
		readonly cause: unknown,
	) {
		super(
			`${section} "${key}" could not be written: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
		this.name = "ImportWriteError";
	}
}

const applyDocument = async (
	deps: ConfigImportDeps,
	input: ImportConfigInput,
	document: ReaderConfigDocument,
	existing: ExistingConfig,
): Promise<ApplyResult> => {
	const { repositories } = deps;
	const now = deps.now ?? Date.now;
	const { accountConfigId } = input;

	const items: ConfigImportItemReport[] = [];
	const warnings: ConfigImportProblem[] = [];
	const accountsNeedingCredentials: string[] = [];
	const unresolvedRefs: ConfigImportUnresolvedRefItem[] = [];

	const record = (
		section: ConfigImportItemReport["section"],
		key: string,
		verdict: ConfigImportItemReport["verdict"],
	): void => {
		items.push({ section, key, verdict });
	};

	const write = async <T>(
		section: ConfigImportItemReport["section"],
		key: string,
		run: () => Promise<T>,
	): Promise<T> =>
		run().catch((error: unknown) => {
			throw new ImportWriteError(section, key, error);
		});

	// ---- accounts -------------------------------------------------------
	const existingByEmail = new Map(
		existing.accounts.map(
			(account) => [normalize(account.email), account] as const,
		),
	);
	const existingById = new Map(
		existing.accounts.map((account) => [account.accountId, account] as const),
	);
	/** The id in the file → the id this instance actually holds it under. */
	const liveAccountId = new Map<string, string>();

	for (const account of document.accounts) {
		const held =
			existingById.get(account.accountId) ??
			existingByEmail.get(normalize(account.email));
		const endpoints = {
			username: account.username,
			email: account.email,
			authType: account.authType,
			imapHost: account.imap.host,
			imapPort: account.imap.port,
			imapTls: account.imap.tls,
			imapStartTls: account.imap.startTls,
			smtpEnabled: account.smtp.enabled,
			smtpHost: account.smtp.host,
			smtpPort: account.smtp.port,
			smtpTls: account.smtp.tls,
			smtpStartTls: account.smtp.startTls,
			smtpUsername: account.smtp.username,
		};

		if (held) {
			// The file carries no credential, so it cannot invalidate the one this
			// account already has: `isActive` and `connectionState` are left alone.
			await write(ConfigImportSection.Accounts, account.email, () =>
				repositories.account.update(held.accountId, endpoints),
			);
			liveAccountId.set(account.accountId, held.accountId);
			record(
				ConfigImportSection.Accounts,
				account.email,
				ConfigImportVerdict.Updated,
			);
			continue;
		}

		const created = await write(
			ConfigImportSection.Accounts,
			account.email,
			() =>
				repositories.account.create({
					// Verbatim: a resynced message id hashes from it, so preserving it is
					// what keeps every filter anchor's provenance valid across the drop.
					accountId: account.accountId,
					accountConfigId,
					...endpoints,
					isActive: false,
					connectionState: landingState(account),
				}),
		);
		liveAccountId.set(account.accountId, created.accountId);
		accountsNeedingCredentials.push(created.accountId);
		record(
			ConfigImportSection.Accounts,
			account.email,
			ConfigImportVerdict.Created,
		);
	}

	const foldersOf = (fileAccountId: string): Map<string, string> =>
		existing.mailboxPaths.get(
			liveAccountId.get(fileAccountId) ?? fileAccountId,
		) ?? new Map();

	// ---- labels ---------------------------------------------------------
	const labelIdByName = new Map(
		existing.labels.map(
			(label) => [normalize(label.name), label.labelId] as const,
		),
	);

	for (const label of document.labels) {
		const key = normalize(label.name);
		const heldId = labelIdByName.get(key);
		if (heldId) {
			await write(ConfigImportSection.Labels, label.name, () =>
				repositories.label.update(accountConfigId, heldId, {
					name: label.name,
					color: label.color,
				}),
			);
			record(
				ConfigImportSection.Labels,
				label.name,
				ConfigImportVerdict.Updated,
			);
			continue;
		}
		const created = await write(ConfigImportSection.Labels, label.name, () =>
			repositories.label.create({
				accountConfigId,
				name: label.name,
				color: label.color,
			}),
		);
		labelIdByName.set(key, created.labelId);
		record(ConfigImportSection.Labels, label.name, ConfigImportVerdict.Created);
	}

	// ---- filters --------------------------------------------------------
	const existingFilterByName = new Map(
		existing.filters.map((filter) => [normalize(filter.name), filter] as const),
	);
	const filterIdByName = new Map<string, string>();

	const resolveFilterFolder = (
		filter: ConfigFilter,
	): { actionMailboxId: string; pending: boolean } => {
		if (filter.actionFolder === null)
			return { actionMailboxId: NO_ACTION, pending: false };
		const mailboxId = foldersOf(filter.actionFolder.accountId).get(
			filter.actionFolder.folderPath,
		);
		return mailboxId
			? { actionMailboxId: mailboxId, pending: false }
			: { actionMailboxId: NO_ACTION, pending: true };
	};

	for (const filter of document.filters) {
		const key = normalize(filter.name);
		const folder = resolveFilterFolder(filter);
		const shape = {
			scope: filter.scope,
			expiresAt: filter.expiresAt ?? undefined,
			ttl: deriveFilterTtl(filter.scope, filter.expiresAt ?? undefined),
			matchOperator: filter.matchOperator,
			literalClauses: filter.literalClauses,
			actionLabelId:
				filter.actionLabelName === null
					? NO_ACTION
					: (labelIdByName.get(normalize(filter.actionLabelName)) ?? NO_ACTION),
			actionMailboxId: folder.actionMailboxId,
			hasAnchor: filter.anchor !== null,
		};

		const held = existingFilterByName.get(key);
		const filterId = held
			? (
					await write(ConfigImportSection.Filters, filter.name, () =>
						repositories.filter.update(accountConfigId, held.filterId, {
							name: filter.name,
							...shape,
						}),
					)
				).filterId
			: (
					await write(ConfigImportSection.Filters, filter.name, () =>
						repositories.filter.create({
							accountConfigId,
							name: filter.name,
							...shape,
						}),
					)
				).filterId;

		filterIdByName.set(key, filterId);
		record(
			ConfigImportSection.Filters,
			filter.name,
			held ? ConfigImportVerdict.Updated : ConfigImportVerdict.Created,
		);

		if (folder.pending && filter.actionFolder) {
			unresolvedRefs.push({
				kind: ConfigImportRefKind.FilterAction,
				accountId:
					liveAccountId.get(filter.actionFolder.accountId) ??
					filter.actionFolder.accountId,
				folderPath: filter.actionFolder.folderPath,
				target: filterId,
			});
			warnings.push(
				problem(
					"folder_not_found_yet",
					`Filter "${filter.name}" files mail into "${filter.actionFolder.folderPath}", which this account does not hold yet. It is bound once the folder list has been read.`,
					{ filter: filter.name, folderPath: filter.actionFolder.folderPath },
				),
			);
		}
	}

	// ---- anchors --------------------------------------------------------
	for (const filter of document.filters) {
		const { anchor } = filter;
		if (anchor === null) continue;
		const filterId = filterIdByName.get(normalize(filter.name));
		if (filterId === undefined) continue;

		const { embedAnchor } = deps;
		const embedded = embedAnchor
			? await write(ConfigImportSection.Filters, filter.name, () =>
					embedAnchor(anchor.sourceText),
				)
			: undefined;

		if (!embedded) {
			warnings.push(
				problem(
					"anchor_not_embedded",
					`The example behind filter "${filter.name}" is carried as text; its vector is rebuilt the first time the filter runs.`,
					{ filter: filter.name },
				),
			);
		}

		await write(ConfigImportSection.Filters, filter.name, () =>
			repositories.filterAnchor.put({
				accountConfigId,
				filterId,
				anchorEmbedding: embedded?.embedding ?? [],
				anchorEmbeddingId: embedded?.embeddingId ?? ANCHOR_EMBEDDING_PENDING,
				anchorSourceText: anchor.sourceText,
				anchorMessageId: anchor.sourceMessageId,
			}),
		);
	}

	// ---- address flags --------------------------------------------------
	for (const entry of document.addressFlags) {
		await write(ConfigImportSection.AddressFlags, entry.normalizedEmail, () =>
			writeAddressFlags(deps, accountConfigId, entry),
		);
		record(
			ConfigImportSection.AddressFlags,
			entry.normalizedEmail,
			existing.addressEmails.has(normalize(entry.normalizedEmail))
				? ConfigImportVerdict.Updated
				: ConfigImportVerdict.Created,
		);
	}

	// ---- settings -------------------------------------------------------
	const settings = new SettingWriter(deps, accountConfigId);

	await write(ConfigImportSection.Settings, "accountConfig", () =>
		ensureAccountConfig(deps, input, document),
	);

	if (document.accountConfig.defaultComposerFormat !== undefined) {
		await write(ConfigImportSection.Settings, "composer format", () =>
			settings.put(AccountSettingName.DefaultComposerFormat, {
				kind: "String",
				value: document.accountConfig.defaultComposerFormat as string,
			}),
		);
	}

	const pinned = [
		...new Set(document.accounts.flatMap((account) => account.pinnedFolders)),
	];
	if (pinned.length > 0) {
		await write(ConfigImportSection.Settings, "pinned folders", () =>
			settings.put(AccountSettingName.PinnedFolders, {
				kind: "StringList",
				value: pinned,
			}),
		);
	}

	for (const account of document.accounts) {
		const accountId = liveAccountId.get(account.accountId) ?? account.accountId;
		await write(ConfigImportSection.Settings, account.email, () =>
			settings.writeAccount(account, accountId),
		);
		unresolvedRefs.push(
			...(await write(ConfigImportSection.Settings, account.email, () =>
				settings.writeFolders(account, accountId, foldersOf(account.accountId)),
			)),
		);
		record(
			ConfigImportSection.Settings,
			account.email,
			ConfigImportVerdict.Updated,
		);
	}

	for (const ref of unresolvedRefs) {
		if (ref.kind === ConfigImportRefKind.FilterAction) continue;
		warnings.push(
			problem(
				"folder_not_found_yet",
				`"${ref.folderPath}" is not a folder this account holds yet. It is bound once the folder list has been read.`,
				{ folderPath: ref.folderPath, accountId: ref.accountId },
			),
		);
	}

	const pendingFolders = unresolvedRefs.length > 0;
	const row = await write(ConfigImportSection.Settings, "import record", () =>
		repositories.configImport.create({
			accountConfigId,
			schemaVersion: document.schemaVersion,
			state: pendingFolders
				? ConfigImportState.Pending
				: ConfigImportState.Complete,
			document: document as unknown as Record<string, unknown>,
			unresolvedRefs,
			completedAt: pendingFolders ? 0 : now(),
		}),
	);

	return {
		items,
		warnings,
		accountsNeedingCredentials,
		unresolvedRefs,
		importId: row.importId,
	};
};

/**
 * An address arrives ahead of any mail, keyed on the email string, so its id
 * re-derives from the importing configuration. The flags then go on through the
 * existing merge fold rather than replacing the stored object: a resync running
 * alongside this keeps the counters and the machine-derived flags it has
 * already worked out.
 */
const writeAddressFlags = async (
	deps: ConfigImportDeps,
	accountConfigId: string,
	entry: ConfigAddressFlagsEntry,
): Promise<void> => {
	const normalizedEmail = normalize(entry.normalizedEmail);
	const at = normalizedEmail.lastIndexOf("@");
	const addressId = deriveAddressId(accountConfigId, normalizedEmail);
	await deps.repositories.address.upsertAddress({
		addressId,
		accountConfigId,
		displayName: entry.displayName,
		localPart: at === -1 ? normalizedEmail : normalizedEmail.slice(0, at),
		domain: at === -1 ? "" : normalizedEmail.slice(at + 1),
		normalizedEmail,
		normalizedCompound:
			`${entry.displayName.toLowerCase()} ${normalizedEmail}`.trim(),
	});
	await deps.repositories.address.mergeFlags(
		accountConfigId,
		addressId,
		entry.flags,
	);
};

/**
 * The configuration row itself. A fresh instance holds none — `GET /config`
 * synthesizes an empty answer rather than writing one — so an import into a
 * dropped database has to materialize it before anything can hang off it.
 */
const ensureAccountConfig = async (
	deps: ConfigImportDeps,
	input: ImportConfigInput,
	document: ReaderConfigDocument,
): Promise<void> => {
	const { accountConfig } = deps.repositories;
	const held = await accountConfig
		.get(input.accountConfigId)
		.catch(() => undefined);
	const name = document.accountConfig.name;

	if (!held) {
		await accountConfig.create({
			accountConfigId: input.accountConfigId,
			userId: input.userId,
			name,
		});
		return;
	}
	if (name !== "" && name !== held.name) {
		await accountConfig.update(input.accountConfigId, { name });
	}
};

/** Every per-account setting an import writes, keyed the way the registry spells it. */
class SettingWriter {
	constructor(
		private readonly deps: ConfigImportDeps,
		private readonly accountConfigId: string,
	) {}

	put(name: string, value: AccountSettingValue): Promise<unknown> {
		return this.deps.repositories.accountSetting.upsert({
			accountConfigId: this.accountConfigId,
			name,
			value,
		});
	}

	async writeAccount(account: ConfigAccount, accountId: string): Promise<void> {
		const per = (base: string): string => composeSettingName(base, accountId);

		if (account.displayName !== "") {
			await this.put(per(AccountSettingName.AccountDisplayName), {
				kind: "String",
				value: account.displayName,
			});
		}
		if (account.muted !== null) {
			await this.put(per(AccountSettingName.AccountMuted), {
				kind: "MutedFlag",
				value: account.muted,
			});
		}
		if (account.composeLanguages.length > 0) {
			await this.put(per(AccountSettingName.AccountComposeLanguages), {
				kind: "StringList",
				value: account.composeLanguages,
			});
		}
		if (account.signature.plainText !== "") {
			await this.put(per(AccountSettingName.AccountSignaturePlainText), {
				kind: "String",
				value: account.signature.plainText,
			});
		}
		if (account.signature.html !== "") {
			await this.put(per(AccountSettingName.AccountSignatureHtml), {
				kind: "String",
				value: account.signature.html,
			});
		}
	}

	/**
	 * The folder-keyed half. A role's recorded path is written whatever happens —
	 * it is the user's decision, and it is what the binder resolves against
	 * later; only the appointment itself waits for a mailbox to exist.
	 */
	async writeFolders(
		account: ConfigAccount,
		accountId: string,
		folders: ReadonlyMap<string, string>,
	): Promise<ConfigImportUnresolvedRefItem[]> {
		const pending: ConfigImportUnresolvedRefItem[] = [];

		for (const role of account.folderRoles) {
			await this.put(
				composeFolderRoleAppointmentLabelName(
					accountId,
					role.role as CanonicalMailboxRoleValue,
				),
				{ kind: "String", value: role.folderPath },
			);
			const mailboxId = folders.get(role.folderPath);
			if (mailboxId === undefined) {
				pending.push({
					kind: ConfigImportRefKind.FolderRole,
					accountId,
					folderPath: role.folderPath,
					target: role.role,
				});
				continue;
			}
			await this.put(
				composeFolderRoleAppointmentName(
					accountId,
					role.role as CanonicalMailboxRoleValue,
				),
				{ kind: "String", value: mailboxId },
			);
		}

		for (const override of account.folderOverrides) {
			const mailboxId = folders.get(override.folderPath);
			if (mailboxId === undefined) {
				pending.push({
					kind: ConfigImportRefKind.MailboxOverride,
					accountId,
					folderPath: override.folderPath,
					target: override.folderPath,
				});
				continue;
			}
			await this.writeMailboxOverride(mailboxId, override);
		}

		return pending;
	}

	async writeMailboxOverride(
		mailboxId: string,
		override: ConfigAccount["folderOverrides"][number],
	): Promise<void> {
		if (override.displayName !== "") {
			await this.put(
				composeSettingName(AccountSettingName.MailboxDisplayName, mailboxId),
				{ kind: "String", value: override.displayName },
			);
		}
		if (override.muted !== null) {
			await this.put(
				composeSettingName(AccountSettingName.MailboxMuted, mailboxId),
				{ kind: "MutedFlag", value: override.muted },
			);
		}
	}
}

/**
 * Validate, or validate and apply, one configuration document.
 *
 * The order is fixed: parse and migrate, check every reference and every
 * natural key against what this configuration already holds, and only then
 * write — inside one transaction, accounts before labels before filters before
 * their anchors before addresses before settings, because each of those reads
 * an id the one before it minted.
 *
 * A document this reader will not import is the operation's expected outcome,
 * not a fault: it comes back as a report saying why. A fault on the way to the
 * store is a fault, and propagates.
 */
export const importConfig = async (
	deps: ConfigImportDeps,
	input: ImportConfigInput,
): Promise<ConfigImportOutcome> => {
	let document: ReaderConfigDocument;
	try {
		document = readConfigDocument(input.document);
	} catch (error) {
		if (!(error instanceof ConfigReadError)) throw error;
		return rejected(claimedVersion(input.document), [
			problem(error.code, error.message),
		]);
	}

	const existing = await readExisting(deps, input.accountConfigId);
	const held =
		existing.accounts.length +
		existing.labels.length +
		existing.filters.length +
		existing.flaggedAddresses;

	if (held > 0 && input.onExisting === "abort") {
		return {
			outcome: "conflict",
			conflict: {
				code: "config_not_empty",
				message:
					"This configuration already holds accounts, labels, filters or flagged senders. Import it again with merge to fold the file into what is here.",
				details: {
					accounts: String(existing.accounts.length),
					labels: String(existing.labels.length),
					filters: String(existing.filters.length),
					addressFlags: String(existing.flaggedAddresses),
				},
			},
		};
	}

	const errors = validateDocument(document, existing);
	if (errors.length > 0) return rejected(document.schemaVersion, errors);

	if (input.mode === "validate") {
		return {
			outcome: "report",
			report: {
				valid: true,
				schemaVersion: document.schemaVersion,
				applied: false,
				items: plan(document, existing),
				errors: [],
				warnings: [],
				accountsNeedingCredentials: [],
			},
		};
	}

	try {
		const applied = await deps.transaction(() =>
			applyDocument(deps, input, document, existing),
		);
		return {
			outcome: "report",
			report: {
				importId: applied.importId,
				valid: true,
				schemaVersion: document.schemaVersion,
				applied: true,
				items: applied.items,
				errors: [],
				warnings: applied.warnings,
				accountsNeedingCredentials: applied.accountsNeedingCredentials,
			},
		};
	} catch (error) {
		if (!(error instanceof ImportWriteError)) throw error;
		// The apply is one write set, so a failure part-way through leaves nothing
		// behind. What the report owes the reader is where it stopped.
		return {
			outcome: "report",
			report: {
				valid: true,
				schemaVersion: document.schemaVersion,
				applied: false,
				items: [
					{
						section: error.section,
						key: error.key,
						verdict: ConfigImportVerdict.Rejected,
						reason: error.message,
					},
				],
				errors: [
					problem(
						"import_write_failed",
						`${error.message} Nothing was written; the import stopped here.`,
						{ section: error.section, key: error.key },
					),
				],
				warnings: [],
				accountsNeedingCredentials: [],
			},
		};
	}
};

/** What an apply would do, item by item — the dry run's whole answer. */
const plan = (
	document: ReaderConfigDocument,
	existing: ExistingConfig,
): ConfigImportItemReport[] => {
	const items: ConfigImportItemReport[] = [];
	const heldEmails = new Set(
		existing.accounts.map((account) => normalize(account.email)),
	);
	const heldLabels = new Set(
		existing.labels.map((label) => normalize(label.name)),
	);
	const heldFilters = new Set(
		existing.filters.map((filter) => normalize(filter.name)),
	);

	const verdict = (held: boolean): ConfigImportItemReport["verdict"] =>
		held ? ConfigImportVerdict.Updated : ConfigImportVerdict.Created;

	for (const account of document.accounts) {
		items.push({
			section: ConfigImportSection.Accounts,
			key: account.email,
			verdict: verdict(heldEmails.has(normalize(account.email))),
		});
	}
	for (const label of document.labels) {
		items.push({
			section: ConfigImportSection.Labels,
			key: label.name,
			verdict: verdict(heldLabels.has(normalize(label.name))),
		});
	}
	for (const filter of document.filters) {
		items.push({
			section: ConfigImportSection.Filters,
			key: filter.name,
			verdict: verdict(heldFilters.has(normalize(filter.name))),
		});
	}
	for (const entry of document.addressFlags) {
		items.push({
			section: ConfigImportSection.AddressFlags,
			key: entry.normalizedEmail,
			verdict: verdict(
				existing.addressEmails.has(normalize(entry.normalizedEmail)),
			),
		});
	}
	for (const account of document.accounts) {
		items.push({
			section: ConfigImportSection.Settings,
			key: account.email,
			verdict: ConfigImportVerdict.Updated,
		});
	}
	return items;
};
