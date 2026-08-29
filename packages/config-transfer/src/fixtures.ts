import type {
	AccountConfigItem,
	AccountItem,
	AccountSettingItem,
	AddressItem,
	FilterAnchorItem,
	FilterItem,
	LabelItem,
	MailboxItem,
} from "@remit/data-ports";
import type { ConfigExportRepositories } from "./repositories.js";

/**
 * A configuration held in memory, wired up as the repositories the export
 * reads. Fixtures rather than a database: what is under test is which decisions
 * reach the file and which never do, and a store is not the thing that decides
 * either.
 */
export interface ConfigFixture {
	accountConfig: AccountConfigItem;
	accounts: AccountItem[];
	settings: AccountSettingItem[];
	mailboxes: MailboxItem[];
	labels: LabelItem[];
	filters: FilterItem[];
	anchors: FilterAnchorItem[];
	addresses: AddressItem[];
	/** Page size for the address listing, so paging is exercised. */
	addressPageSize?: number;
}

export const ACCOUNT_CONFIG_ID = "0d9c8b7a6e5f4d3cb2a10f9e8";
export const PASSWORD_ACCOUNT_ID = "6f4c2c309a2c4a7f9f9f1f2c3";
export const OAUTH_ACCOUNT_ID = "b3a1d0c75e644f1b8c2a77e9d";

const NOW = 1756281600000;

export const makeAccountConfig = (
	overrides: Partial<AccountConfigItem> = {},
): AccountConfigItem => ({
	accountConfigId: ACCOUNT_CONFIG_ID,
	userId: "7c1f0a2e-3b4d-4c5e-8f90-a1b2c3d4e5f6",
	name: "Matthijs",
	state: "active",
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
});

export const makeAccount = (
	overrides: Partial<AccountItem> & Pick<AccountItem, "accountId">,
): AccountItem => ({
	accountConfigId: ACCOUNT_CONFIG_ID,
	username: "matthijs@ischen.nl",
	email: "matthijs@ischen.nl",
	authType: "password",
	imapHost: "imap.ischen.nl",
	imapPort: 993,
	imapTls: true,
	imapStartTls: false,
	smtpEnabled: true,
	smtpHost: "smtp.ischen.nl",
	smtpPort: 587,
	smtpTls: false,
	smtpStartTls: true,
	smtpUsername: "",
	isActive: true,
	connectionState: "authenticated",
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
});

export const makeMailbox = (
	overrides: Partial<MailboxItem> &
		Pick<MailboxItem, "mailboxId" | "accountId" | "fullPath">,
): MailboxItem => ({
	namespaceType: "personal",
	namespacePrefix: "",
	hierarchyDelimiter: ".",
	uidValidity: 1,
	uidNext: 2,
	highestModseq: "1",
	messageCount: 0,
	unseenCount: 0,
	deletedCount: 0,
	totalSize: 0,
	lastSyncUid: 0,
	highWaterMarkUid: 0,
	lastMessageSyncAt: NOW,
	parentMailboxId: "",
	cursorState: "normal",
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
});

export const makeSetting = (
	name: string,
	value: AccountSettingItem["value"],
): AccountSettingItem => ({
	accountSettingId: `setting:${name}`,
	accountConfigId: ACCOUNT_CONFIG_ID,
	name,
	value,
	createdAt: NOW,
	updatedAt: NOW,
});

export const makeLabel = (
	overrides: Partial<LabelItem> & Pick<LabelItem, "labelId" | "name">,
): LabelItem => ({
	accountConfigId: ACCOUNT_CONFIG_ID,
	normalizedName: overrides.name.toLowerCase(),
	color: "Default",
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
});

export const makeFilter = (
	overrides: Partial<FilterItem> & Pick<FilterItem, "filterId" | "name">,
): FilterItem => ({
	accountConfigId: ACCOUNT_CONFIG_ID,
	scope: "Standing",
	state: "Active",
	hasAnchor: false,
	ruleChangedAt: NOW,
	actionChangedAt: NOW,
	matchOperator: "And",
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "None",
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
});

export const makeAnchor = (
	overrides: Partial<FilterAnchorItem> & Pick<FilterAnchorItem, "filterId">,
): FilterAnchorItem => ({
	accountConfigId: ACCOUNT_CONFIG_ID,
	anchorEmbedding: [0.11, 0.22, 0.33],
	anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
	anchorSourceText: "the release note this filter was drawn from",
	anchorMessageId: "2c9e4b117d5a4f609a315b8c0",
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
});

export const makeAddress = (
	overrides: Partial<AddressItem> &
		Pick<AddressItem, "addressId" | "normalizedEmail">,
): AddressItem => ({
	accountConfigId: ACCOUNT_CONFIG_ID,
	localPart: overrides.normalizedEmail.split("@")[0] ?? "",
	domain: overrides.normalizedEmail.split("@")[1] ?? "",
	normalizedCompound: overrides.normalizedEmail,
	flags: {},
	inboundCount: 0,
	outboundCount: 0,
	replyCount: 0,
	lastInboundAt: 0,
	lastReplyAt: 0,
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
});

/**
 * An address flagged before `setAt` was recorded, as v0.6 left it in the
 * database. The stored type cannot spell the row — it describes what is written
 * today — so the fixture asserts the shape rather than deriving it, which is
 * the whole point: this is what the live instance actually holds.
 */
export const makeLegacyFlaggedAddress = (): AddressItem =>
	makeAddress({
		addressId: "adr-legacy",
		normalizedEmail: "old@legacy.example",
		displayName: "Legacy",
		flags: {
			vip: { value: true, setBy: "web-client" },
			category: { value: "newsletter" },
		} as unknown as AddressItem["flags"],
	});

/** The fixture, behind the repository interfaces the export takes. */
export const asRepositories = (
	fixture: ConfigFixture,
): ConfigExportRepositories => ({
	accountConfig: {
		get: async () => fixture.accountConfig,
	},
	account: {
		listAllByAccountConfig: async () => fixture.accounts,
	},
	accountSetting: {
		listByAccountConfig: async () => fixture.settings,
	},
	mailbox: {
		listAllByAccount: async (accountId: string) =>
			fixture.mailboxes.filter((mailbox) => mailbox.accountId === accountId),
	},
	label: {
		listByAccountConfig: async () => fixture.labels,
	},
	filter: {
		listByAccountConfig: async () => fixture.filters,
	},
	filterAnchor: {
		listByAccountConfig: async () => fixture.anchors,
	},
	address: {
		listByAccountConfig: async ({ cursor }) => {
			const size = fixture.addressPageSize ?? fixture.addresses.length + 1;
			const offset = cursor ? Number(cursor) : 0;
			const items = fixture.addresses.slice(offset, offset + size);
			const next = offset + size;
			return {
				items,
				continuationToken:
					next < fixture.addresses.length ? String(next) : undefined,
			};
		},
	},
});
