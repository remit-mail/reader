import type {
	AccountConfigItem,
	IAccountRepository,
	IAccountSettingRepository,
	IAddressRepository,
	IFilterAnchorRepository,
	IFilterRepository,
	ILabelRepository,
	IMailboxRepository,
} from "@remit/data-ports";

/**
 * Everything the export reads, and nothing else. Repositories rather than a
 * client or an HTTP surface: the same reader answers `GET /config/export` in
 * the API process and `remit config save` in a container with no session, and
 * neither is allowed to be the one that decides what a configuration contains.
 */
export interface ConfigExportRepositories {
	accountConfig: {
		get: (accountConfigId: string) => Promise<AccountConfigItem>;
	};
	account: Pick<IAccountRepository, "listAllByAccountConfig">;
	accountSetting: Pick<IAccountSettingRepository, "listByAccountConfig">;
	mailbox: Pick<IMailboxRepository, "listAllByAccount">;
	label: Pick<ILabelRepository, "listByAccountConfig">;
	filter: Pick<IFilterRepository, "listByAccountConfig">;
	filterAnchor: Pick<IFilterAnchorRepository, "listByAccountConfig">;
	address: Pick<IAddressRepository, "listByAccountConfig">;
}

/** Who wrote the file, and where from. Recorded; never authoritative on import. */
export interface ConfigExportIdentity {
	app: string;
	version: string;
	/** ISO 8601 with an explicit offset. */
	exportedAt: string;
	instance: string;
}
