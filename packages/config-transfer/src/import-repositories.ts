import type {
	AccountConfigItem,
	CreateAccountConfigInput,
	IAccountRepository,
	IAccountSettingRepository,
	IAddressRepository,
	IConfigImportRepository,
	IFilterAnchorRepository,
	IFilterRepository,
	ILabelRepository,
	IMailboxRepository,
	UpdateAccountConfigInput,
} from "@remit/data-ports";

/**
 * Everything the import reads and writes, and nothing else. Repositories rather
 * than a client or an HTTP surface, for the same reason the export takes them:
 * what a configuration contains is decided here, not by whichever process
 * happens to be holding the file.
 */
export interface ConfigImportRepositories {
	accountConfig: {
		get: (accountConfigId: string) => Promise<AccountConfigItem>;
		create: (input: CreateAccountConfigInput) => Promise<AccountConfigItem>;
		update: (
			accountConfigId: string,
			input: UpdateAccountConfigInput,
		) => Promise<AccountConfigItem>;
	};
	account: Pick<
		IAccountRepository,
		"listAllByAccountConfig" | "create" | "update"
	>;
	accountSetting: Pick<
		IAccountSettingRepository,
		"listByAccountConfig" | "upsert"
	>;
	mailbox: Pick<IMailboxRepository, "listAllByAccount">;
	label: Pick<ILabelRepository, "listByAccountConfig" | "create" | "update">;
	filter: Pick<IFilterRepository, "listByAccountConfig" | "create" | "update">;
	filterAnchor: Pick<IFilterAnchorRepository, "put">;
	address: Pick<
		IAddressRepository,
		"listByAccountConfig" | "upsertAddress" | "mergeFlags"
	>;
	configImport: Pick<
		IConfigImportRepository,
		"create" | "update" | "listByAccountConfig"
	>;
}

/**
 * A filter anchor, re-embedded from the source text the file carries. The
 * stored vector is a function of the model that produced it, so it never
 * travels; this is the one thing an import has to compute rather than copy.
 *
 * Optional, and free to answer `undefined`, because a configuration file has to
 * import on a deployment that ships no embedding model at all. Either way the
 * anchor lands stamped `ANCHOR_EMBEDDING_PENDING`, which the existing lazy
 * repair (`refreshAnchorForEmbedder`) treats as needing a fresh vector the
 * first time the filter is matched.
 */
export type EmbedAnchor = (
	sourceText: string,
) => Promise<{ embedding: number[]; embeddingId: string } | undefined>;

/**
 * Persist one role's folder appointment. Injected rather than composed here:
 * an appointment row means a person decided, and it keeps that meaning only
 * while one writer produces it — the same one every other appointment in the
 * repo goes through.
 */
export type AppointFolderRole = (
	accountConfigId: string,
	accountId: string,
	role: string,
	mailboxId: string,
	lastKnownPath: string,
) => Promise<void>;

export interface ConfigImportDeps {
	repositories: ConfigImportRepositories;
	appointFolderRole: AppointFolderRole;
	/**
	 * Runs the whole apply as one write set. Nothing is written until the
	 * document has validated, and a failure inside this aborts the remainder.
	 */
	transaction: <T>(run: () => Promise<T>) => Promise<T>;
	embedAnchor?: EmbedAnchor;
	now?: () => number;
}
