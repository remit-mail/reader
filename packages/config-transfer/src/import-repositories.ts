import type {
	AccountConfigItem,
	CreateAccountConfigInput,
	IAccountRepository,
	IAccountSettingRepository,
	IAddressRepository,
	IConfigImportRepository,
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
	/**
	 * Not the suggest listing, for the reason the export refuses it too: what a
	 * configuration already holds is decided over every stored row, junk-only
	 * ones included (#1029).
	 */
	address: Pick<
		IAddressRepository,
		"listAllByAccountConfigPage" | "upsertAddress" | "mergeFlags"
	>;
	configImport: Pick<
		IConfigImportRepository,
		"create" | "update" | "listByAccountConfig"
	>;
}

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
	 * Runs the whole apply as one write set, rolling back on any throw.
	 *
	 * Optional, and its presence is the fact the report words itself from: a
	 * backend that supplies this rolls a failed apply back to nothing, and one
	 * that does not leaves behind whatever landed before the failure. Only the
	 * caller knows which, so it says so by passing this or omitting it rather
	 * than by handing over a pass-through that would claim atomicity it has not
	 * got.
	 */
	transaction?: <T>(run: () => Promise<T>) => Promise<T>;
	now?: () => number;
}
