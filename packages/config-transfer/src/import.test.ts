import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	AccountConfigItem,
	AccountItem,
	AccountSettingItem,
	AddressItem,
	ConfigImportItem,
	FilterAnchorItem,
	FilterItem,
	LabelItem,
	MailboxItem,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import {
	composeFolderRoleAppointmentLabelName,
	composeFolderRoleAppointmentName,
} from "@remit/data-ports/folder-role";
import { deriveAddressId } from "@remit/data-ports/id";
import { bindImportedFolders, pendingImportOf } from "./binder.js";
import { readConfigForExport } from "./export.js";
import {
	ACCOUNT_CONFIG_ID,
	asRepositories,
	type ConfigFixture,
	makeAccount,
	makeAccountConfig,
	makeAddress,
	makeAnchor,
	makeFilter,
	makeLabel,
	makeMailbox,
	makeSetting,
	OAUTH_ACCOUNT_ID,
	PASSWORD_ACCOUNT_ID,
} from "./fixtures.js";
import { ANCHOR_EMBEDDING_PENDING, importConfig } from "./import.js";
import type { ConfigImportDeps } from "./import-repositories.js";

const IDENTITY = {
	app: "reader",
	version: "v0.1.0",
	exportedAt: "2026-08-27T09:15:00+02:00",
	instance: "reader.ischen.nl",
};

const TARGET_CONFIG_ID = "1a2b3c4d5e6f7a8b9c0d1e2f3";
const TARGET_USER_ID = "9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b";
const EMBEDDING_ID = "amazon.titan-embed-text-v2:0@1024";

const INBOX_ID = "mbx-inbox";
const SENT_ID = "mbx-sent";
const INVOICES_ID = "mbx-invoices";
const LISTS_ID = "mbx-lists";
const OAUTH_INBOX_ID = "mbx-oauth-inbox";

// ---------------------------------------------------------------------------
// An in-memory configuration, behind the repositories both halves take. What is
// under test is which decisions cross and which never do, and a store is not
// what decides either.
// ---------------------------------------------------------------------------

interface Store {
	accountConfigs: Map<string, AccountConfigItem>;
	accounts: AccountItem[];
	settings: Map<string, AccountSettingItem>;
	mailboxes: MailboxItem[];
	labels: LabelItem[];
	filters: FilterItem[];
	anchors: FilterAnchorItem[];
	addresses: AddressItem[];
	imports: ConfigImportItem[];
	/** Set to make the next write of this kind fail, for the abort path. */
	failOn?: string;
}

const NOW = 1756281600000;
let ids = 0;
const nextId = (prefix: string): string => `${prefix}-${++ids}`;

const emptyStore = (): Store => ({
	accountConfigs: new Map(),
	accounts: [],
	settings: new Map(),
	mailboxes: [],
	labels: [],
	filters: [],
	anchors: [],
	addresses: [],
	imports: [],
});

const storeFromFixture = (fixture: ConfigFixture): Store => ({
	accountConfigs: new Map([
		[fixture.accountConfig.accountConfigId, fixture.accountConfig],
	]),
	accounts: [...fixture.accounts],
	settings: new Map(
		fixture.settings.map((setting) => [setting.name, setting] as const),
	),
	mailboxes: [...fixture.mailboxes],
	labels: [...fixture.labels],
	filters: [...fixture.filters],
	anchors: [...fixture.anchors],
	addresses: [...fixture.addresses],
	imports: [],
});

// biome-ignore lint/suspicious/noExplicitAny: one fake standing in for every port
const repositoriesOf = (store: Store, accountConfigId: string): any => {
	const fail = (kind: string): void => {
		if (store.failOn === kind) throw new Error(`store refused a ${kind} write`);
	};
	return {
		accountConfig: {
			get: async (id: string) => {
				const held = store.accountConfigs.get(id);
				if (!held) throw new NotFoundError(`AccountConfig not found: ${id}`);
				return held;
			},
			create: async (input: {
				accountConfigId?: string;
				userId: string;
				name?: string;
			}) => {
				const row: AccountConfigItem = {
					accountConfigId: input.accountConfigId ?? nextId("cfg"),
					userId: input.userId,
					name: input.name ?? "",
					state: "active",
					createdAt: NOW,
					updatedAt: NOW,
				};
				store.accountConfigs.set(row.accountConfigId, row);
				return row;
			},
			update: async (id: string, patch: Partial<AccountConfigItem>) => {
				const held = store.accountConfigs.get(id);
				if (!held) throw new NotFoundError(`AccountConfig not found: ${id}`);
				const next = { ...held, ...patch };
				store.accountConfigs.set(id, next);
				return next;
			},
		},
		account: {
			listAllByAccountConfig: async () =>
				store.accounts.filter(
					(account) => account.accountConfigId === accountConfigId,
				),
			create: async (input: Partial<AccountItem>) => {
				fail("account");
				const row = makeAccount({
					...input,
					accountConfigId,
					accountId: input.accountId ?? nextId("acc"),
				} as Partial<AccountItem> & Pick<AccountItem, "accountId">);
				store.accounts.push(row);
				return row;
			},
			update: async (accountId: string, patch: Partial<AccountItem>) => {
				const at = store.accounts.findIndex(
					(account) => account.accountId === accountId,
				);
				if (at === -1)
					throw new NotFoundError(`Account not found: ${accountId}`);
				const next = { ...store.accounts[at], ...patch };
				store.accounts[at] = next;
				return next;
			},
		},
		accountSetting: {
			listByAccountConfig: async () => [...store.settings.values()],
			upsert: async (input: {
				name: string;
				value: AccountSettingItem["value"];
			}) => {
				const row = makeSetting(input.name, input.value);
				store.settings.set(input.name, row);
				return row;
			},
		},
		mailbox: {
			listAllByAccount: async (accountId: string) =>
				store.mailboxes.filter((mailbox) => mailbox.accountId === accountId),
		},
		label: {
			listByAccountConfig: async () => [...store.labels],
			create: async (input: { name: string; color?: LabelItem["color"] }) => {
				const row = makeLabel({
					labelId: nextId("lbl"),
					name: input.name,
					color: input.color ?? "Default",
					accountConfigId,
				});
				store.labels.push(row);
				return row;
			},
			update: async (
				_configId: string,
				labelId: string,
				patch: Partial<LabelItem>,
			) => {
				const at = store.labels.findIndex((label) => label.labelId === labelId);
				const next = { ...store.labels[at], ...patch };
				store.labels[at] = next;
				return next;
			},
		},
		filter: {
			listByAccountConfig: async () => [...store.filters],
			create: async (input: Partial<FilterItem> & { name: string }) => {
				fail("filter");
				const row = makeFilter({
					...input,
					accountConfigId,
					filterId: nextId("flt"),
				});
				store.filters.push(row);
				return row;
			},
			update: async (
				_configId: string,
				filterId: string,
				patch: Partial<FilterItem>,
			) => {
				const at = store.filters.findIndex(
					(filter) => filter.filterId === filterId,
				);
				const next = { ...store.filters[at], ...patch };
				store.filters[at] = next;
				return next;
			},
		},
		filterAnchor: {
			put: async (input: Partial<FilterAnchorItem> & { filterId: string }) => {
				const row = makeAnchor({ ...input, accountConfigId });
				store.anchors = [
					...store.anchors.filter(
						(anchor) => anchor.filterId !== input.filterId,
					),
					row,
				];
				return row;
			},
			listByAccountConfig: async () => [...store.anchors],
		},
		address: {
			listByAccountConfig: async () => ({
				items: [...store.addresses],
				continuationToken: undefined,
			}),
			upsertAddress: async (
				input: Partial<AddressItem> & {
					addressId: string;
					normalizedEmail: string;
				},
			) => {
				const at = store.addresses.findIndex(
					(address) => address.addressId === input.addressId,
				);
				const row = makeAddress({
					...(at === -1 ? {} : store.addresses[at]),
					...input,
					accountConfigId,
				});
				if (at === -1) store.addresses.push(row);
				else store.addresses[at] = row;
				return row;
			},
			mergeFlags: async (
				_configId: string,
				addressId: string,
				patch: Record<string, unknown>,
			) => {
				const at = store.addresses.findIndex(
					(address) => address.addressId === addressId,
				);
				if (at === -1)
					throw new NotFoundError(`Address not found: ${addressId}`);
				const next = {
					...store.addresses[at],
					flags: { ...store.addresses[at].flags, ...patch },
				};
				store.addresses[at] = next as AddressItem;
				return next;
			},
		},
		configImport: {
			create: async (input: Partial<ConfigImportItem>) => {
				const row = {
					importId: nextId("imp"),
					accountConfigId,
					schemaVersion: 1,
					state: "Pending",
					document: {},
					unresolvedRefs: [],
					createdAt: NOW,
					completedAt: 0,
					updatedAt: NOW,
					...input,
				} as ConfigImportItem;
				store.imports.push(row);
				return row;
			},
			update: async (importId: string, patch: Partial<ConfigImportItem>) => {
				const at = store.imports.findIndex((row) => row.importId === importId);
				const next = { ...store.imports[at], ...patch };
				store.imports[at] = next;
				return next;
			},
			listByAccountConfig: async () => [...store.imports],
		},
	};
};

/**
 * The one writer of a folder-role appointment, stood in for. The pair of rows
 * moves together, the way `writeFolderRoleAppointment` writes them.
 */
const appointFolderRoleInto =
	(store: Store) =>
	async (
		_accountConfigId: string,
		accountId: string,
		role: string,
		mailboxId: string,
		lastKnownPath: string,
	): Promise<void> => {
		const named = composeFolderRoleAppointmentName(accountId, role as "Sent");
		const labelled = composeFolderRoleAppointmentLabelName(
			accountId,
			role as "Sent",
		);
		store.settings.set(
			named,
			makeSetting(named, { kind: "String", value: mailboxId }),
		);
		store.settings.set(
			labelled,
			makeSetting(labelled, { kind: "String", value: lastKnownPath }),
		);
	};

const depsOf = (
	store: Store,
	accountConfigId: string,
	embed = true,
): ConfigImportDeps => ({
	repositories: repositoriesOf(store, accountConfigId),
	appointFolderRole: appointFolderRoleInto(store),
	transaction: (run) => run(),
	embedAnchor: embed
		? async () => ({ embedding: [0.11, 0.22, 0.33], embeddingId: EMBEDDING_ID })
		: undefined,
	now: () => NOW,
});

// ---------------------------------------------------------------------------
// A configuration worth carrying across: two accounts, both auth types, folder
// roles, per-folder overrides, labels, a literal and a semantic filter, and two
// flagged senders.
// ---------------------------------------------------------------------------

const sourceFixture = (): ConfigFixture => ({
	accountConfig: makeAccountConfig(),
	accounts: [
		makeAccount({ accountId: PASSWORD_ACCOUNT_ID }),
		makeAccount({
			accountId: OAUTH_ACCOUNT_ID,
			email: "work@example.com",
			username: "work@example.com",
			authType: "oauthMicrosoft",
			imapHost: "outlook.office365.com",
			smtpEnabled: false,
			smtpHost: "",
		}),
	],
	settings: [
		makeSetting("DefaultComposerFormat", {
			kind: "String",
			value: "markdown",
		}),
		makeSetting(`AccountDisplayName#${PASSWORD_ACCOUNT_ID}`, {
			kind: "String",
			value: "Matthijs van Henten",
		}),
		makeSetting(`AccountComposeLanguages#${PASSWORD_ACCOUNT_ID}`, {
			kind: "StringList",
			value: ["nl-NL", "en-GB"],
		}),
		makeSetting(`AccountSignaturePlainText#${PASSWORD_ACCOUNT_ID}`, {
			kind: "String",
			value: "Matthijs\n",
		}),
		makeSetting(`AccountSignatureHtml#${PASSWORD_ACCOUNT_ID}`, {
			kind: "String",
			value: "<p>Matthijs</p>",
		}),
		makeSetting(`AccountMuted#${OAUTH_ACCOUNT_ID}`, {
			kind: "MutedFlag",
			value: { value: true, setAt: 1750000000000, setBy: "web-client" },
		}),
		makeSetting("PinnedFolders", {
			kind: "StringList",
			value: ["INBOX", "INBOX.Facturen"],
		}),
		makeSetting(`MailboxDisplayName#${LISTS_ID}`, {
			kind: "String",
			value: "dev/null",
		}),
		makeSetting(`MailboxMuted#${LISTS_ID}`, {
			kind: "MutedFlag",
			value: { value: true, setAt: 1756281600000 },
		}),
		makeSetting(composeFolderRoleAppointmentName(PASSWORD_ACCOUNT_ID, "Sent"), {
			kind: "String",
			value: SENT_ID,
		}),
		makeSetting(
			composeFolderRoleAppointmentLabelName(PASSWORD_ACCOUNT_ID, "Sent"),
			{ kind: "String", value: "INBOX.Sent" },
		),
	],
	mailboxes: [
		makeMailbox({
			mailboxId: INBOX_ID,
			accountId: PASSWORD_ACCOUNT_ID,
			fullPath: "INBOX",
		}),
		makeMailbox({
			mailboxId: SENT_ID,
			accountId: PASSWORD_ACCOUNT_ID,
			fullPath: "INBOX.Sent",
		}),
		makeMailbox({
			mailboxId: INVOICES_ID,
			accountId: PASSWORD_ACCOUNT_ID,
			fullPath: "INBOX.Facturen",
		}),
		makeMailbox({
			mailboxId: LISTS_ID,
			accountId: PASSWORD_ACCOUNT_ID,
			fullPath: "INBOX.Lists.dev-null",
		}),
		makeMailbox({
			mailboxId: OAUTH_INBOX_ID,
			accountId: OAUTH_ACCOUNT_ID,
			fullPath: "INBOX",
		}),
	],
	labels: [
		makeLabel({ labelId: "lbl-facturen", name: "Facturen", color: "Blue" }),
		makeLabel({ labelId: "lbl-lezen", name: "Te lezen" }),
	],
	filters: [
		makeFilter({
			filterId: "flt-invoices",
			name: "Invoices to Facturen",
			matchOperator: "Or",
			literalClauses: [
				{ field: "Subject", value: "factuur" },
				{ field: "FromDomain", value: "moneybird.com" },
			],
			actionLabelId: "lbl-facturen",
			actionMailboxId: INVOICES_ID,
		}),
		makeFilter({
			filterId: "flt-semantic",
			name: "Anything like this release note",
			scope: "Temporary",
			expiresAt: "2026-12-31T23:59:59+01:00",
			hasAnchor: true,
		}),
	],
	anchors: [makeAnchor({ filterId: "flt-semantic" })],
	addresses: [
		makeAddress({
			addressId: "adr-bank",
			normalizedEmail: "post@bank.example",
			displayName: "Bank",
			flags: {
				vip: { value: true, setAt: 1750000000000, setBy: "web-client" },
				wellknown: { value: true, setAt: 1750000000000 },
			},
		}),
		makeAddress({
			addressId: "adr-news",
			normalizedEmail: "noreply@newsletter.example",
			flags: {
				unsubscribed: {
					value: true,
					setAt: 1755000000000,
					reason: "unsubscribe link never worked",
				},
			},
		}),
	],
});

const exportSource = () =>
	readConfigForExport(
		asRepositories(sourceFixture()),
		ACCOUNT_CONFIG_ID,
		IDENTITY,
	);

const apply = (
	store: Store,
	document: unknown,
	onExisting: "abort" | "merge" = "abort",
) =>
	importConfig(depsOf(store, TARGET_CONFIG_ID), {
		accountConfigId: TARGET_CONFIG_ID,
		userId: TARGET_USER_ID,
		document,
		mode: "apply",
		onExisting,
	});

const reportOf = (outcome: Awaited<ReturnType<typeof apply>>) => {
	assert.equal(outcome.outcome, "report");
	if (outcome.outcome !== "report") throw new Error("unreachable");
	return outcome.report;
};

/** Discovery, after the fact: the same folders under ids of this instance's own. */
const discover = (
	store: Store,
	accountId: string,
	paths: readonly string[],
): void => {
	for (const fullPath of paths) {
		store.mailboxes.push(
			makeMailbox({ mailboxId: nextId("mbx"), accountId, fullPath }),
		);
	}
};

test("a configuration survives an export, an import and a discovery unchanged", async () => {
	const document = await exportSource();
	const store = emptyStore();

	const report = reportOf(await apply(store, document));
	assert.equal(report.applied, true);
	assert.equal(report.valid, true);

	discover(store, PASSWORD_ACCOUNT_ID, [
		"INBOX",
		"INBOX.Sent",
		"INBOX.Facturen",
		"INBOX.Lists.dev-null",
	]);
	discover(store, OAUTH_ACCOUNT_ID, ["INBOX"]);

	const binder = {
		repositories: repositoriesOf(store, TARGET_CONFIG_ID),
		appointFolderRole: appointFolderRoleInto(store),
	};
	await bindImportedFolders(binder, TARGET_CONFIG_ID, PASSWORD_ACCOUNT_ID);
	await bindImportedFolders(binder, TARGET_CONFIG_ID, OAUTH_ACCOUNT_ID);

	const reexported = await readConfigForExport(
		repositoriesOf(store, TARGET_CONFIG_ID),
		TARGET_CONFIG_ID,
		IDENTITY,
	);

	assert.deepEqual(withoutProvenance(reexported), withoutProvenance(document));
});

/**
 * Provenance records where a file came from and is never applied, and an import
 * deliberately parks every account inactive until its credential is back. Those
 * two aside, the document that comes back out is the document that went in.
 */
const withoutProvenance = (document: {
	provenance: unknown;
	accounts: { isActive: boolean }[];
}): unknown => ({
	...document,
	provenance: null,
	accounts: document.accounts.map((account) => ({
		...account,
		isActive: null,
	})),
});

test("imported accounts land inactive, each needing the credential the file named", async () => {
	const document = await exportSource();
	const store = emptyStore();

	const report = reportOf(await apply(store, document));

	assert.deepEqual(
		[...report.accountsNeedingCredentials].sort(),
		[OAUTH_ACCOUNT_ID, PASSWORD_ACCOUNT_ID].sort(),
	);

	const password = store.accounts.find(
		(account) => account.accountId === PASSWORD_ACCOUNT_ID,
	);
	const oauth = store.accounts.find(
		(account) => account.accountId === OAUTH_ACCOUNT_ID,
	);
	assert.equal(password?.isActive, false);
	assert.equal(password?.connectionState, "credentials_missing");
	assert.equal(oauth?.isActive, false);
	assert.equal(oauth?.connectionState, "reauth_required");
	assert.equal(password?.passwordHash, undefined);
});

test("validate writes nothing and still says what an apply would do", async () => {
	const document = await exportSource();
	const store = emptyStore();

	const outcome = await importConfig(depsOf(store, TARGET_CONFIG_ID), {
		accountConfigId: TARGET_CONFIG_ID,
		userId: TARGET_USER_ID,
		document,
		mode: "validate",
		onExisting: "abort",
	});
	const report = reportOf(outcome);

	assert.equal(report.valid, true);
	assert.equal(report.applied, false);
	assert.equal(report.importId, undefined);
	assert.deepEqual(
		report.items.filter((item) => item.section === "accounts"),
		[
			{ section: "accounts", key: "matthijs@ischen.nl", verdict: "created" },
			{ section: "accounts", key: "work@example.com", verdict: "created" },
		],
	);
	assert.deepEqual(store.accounts, []);
	assert.deepEqual(store.labels, []);
	assert.deepEqual(store.imports, []);
});

test("a configuration that already holds something refuses the default import", async () => {
	const document = await exportSource();
	const store = storeFromFixture(sourceFixture());

	const outcome = await importConfig(depsOf(store, ACCOUNT_CONFIG_ID), {
		accountConfigId: ACCOUNT_CONFIG_ID,
		userId: TARGET_USER_ID,
		document,
		mode: "apply",
		onExisting: "abort",
	});

	assert.equal(outcome.outcome, "conflict");
	if (outcome.outcome !== "conflict") throw new Error("unreachable");
	assert.equal(outcome.conflict.code, "config_not_empty");
	assert.equal(outcome.conflict.details.accounts, "2");
	assert.equal(outcome.conflict.details.labels, "2");
	assert.equal(outcome.conflict.details.addressFlags, "2");
});

test("merge folds the file in and deletes nothing the file left out", async () => {
	const document = await exportSource();
	const store = emptyStore();
	store.labels.push(
		makeLabel({
			labelId: "lbl-local",
			name: "Facturen",
			color: "Red",
			accountConfigId: TARGET_CONFIG_ID,
		}),
		makeLabel({
			labelId: "lbl-only-here",
			name: "Alleen hier",
			accountConfigId: TARGET_CONFIG_ID,
		}),
	);

	const report = reportOf(await apply(store, document, "merge"));

	assert.deepEqual(
		report.items.filter((item) => item.section === "labels"),
		[
			{ section: "labels", key: "Facturen", verdict: "updated" },
			{ section: "labels", key: "Te lezen", verdict: "created" },
		],
	);
	const held = store.labels.find((label) => label.labelId === "lbl-local");
	assert.equal(held?.color, "Blue");
	assert.equal(
		store.labels.some((label) => label.labelId === "lbl-only-here"),
		true,
	);
});

test("a filter's label travels by name, and the imported filter points at the new id", async () => {
	const document = await exportSource();
	const store = emptyStore();

	await apply(store, document);

	const label = store.labels.find((row) => row.name === "Facturen");
	const filter = store.filters.find(
		(row) => row.name === "Invoices to Facturen",
	);
	assert.notEqual(label?.labelId, "lbl-facturen");
	assert.equal(filter?.actionLabelId, label?.labelId);
});

test("a flagged sender arrives ahead of its mail, keyed on the email string", async () => {
	const document = await exportSource();
	const store = emptyStore();
	// A sighting the resync already harvested: the import must merge onto it
	// rather than replace it, so the counters survive.
	store.addresses.push(
		makeAddress({
			addressId: deriveAddressId(TARGET_CONFIG_ID, "post@bank.example"),
			normalizedEmail: "post@bank.example",
			accountConfigId: TARGET_CONFIG_ID,
			inboundCount: 12,
			flags: { junkOnly: { value: true, setAt: 1750000000000 } },
		}),
	);

	await apply(store, document, "merge");

	const bank = store.addresses.find(
		(address) =>
			address.addressId ===
			deriveAddressId(TARGET_CONFIG_ID, "post@bank.example"),
	);
	assert.equal(bank?.inboundCount, 12);
	assert.equal(bank?.flags?.vip?.value, true);
	assert.equal(bank?.flags?.junkOnly?.value, true);
	assert.equal(bank?.flags?.wellknown, undefined);

	const news = store.addresses.find(
		(address) => address.normalizedEmail === "noreply@newsletter.example",
	);
	assert.equal(
		news?.addressId,
		deriveAddressId(TARGET_CONFIG_ID, "noreply@newsletter.example"),
	);
	assert.equal(news?.flags?.unsubscribed?.value, true);
});

test("a folder no mailbox answers to yet is kept, then bound when discovery finds it", async () => {
	const document = await exportSource();
	const store = emptyStore();

	const report = reportOf(await apply(store, document));
	assert.equal(
		report.warnings.some((warning) => warning.code === "folder_not_found_yet"),
		true,
	);

	const row = store.imports[0];
	assert.equal(row.state, "Pending");
	assert.equal(
		pendingImportOf(store.imports)?.folderPaths.includes("INBOX.Facturen"),
		true,
	);

	discover(store, PASSWORD_ACCOUNT_ID, ["INBOX", "INBOX.Facturen"]);
	const binder = {
		repositories: repositoriesOf(store, TARGET_CONFIG_ID),
		appointFolderRole: appointFolderRoleInto(store),
	};
	const first = await bindImportedFolders(
		binder,
		TARGET_CONFIG_ID,
		PASSWORD_ACCOUNT_ID,
	);

	assert.equal(first.bound > 0, true);
	assert.equal(first.stillPending > 0, true);
	const invoices = store.mailboxes.find(
		(mailbox) => mailbox.fullPath === "INBOX.Facturen",
	);
	assert.equal(
		store.filters.find((filter) => filter.name === "Invoices to Facturen")
			?.actionMailboxId,
		invoices?.mailboxId,
	);

	// Replayable: a second discovery over the same folders changes nothing.
	const again = await bindImportedFolders(
		binder,
		TARGET_CONFIG_ID,
		PASSWORD_ACCOUNT_ID,
	);
	assert.equal(again.bound, 0);
	assert.equal(store.imports[0].state, "Pending");

	discover(store, PASSWORD_ACCOUNT_ID, ["INBOX.Sent", "INBOX.Lists.dev-null"]);
	discover(store, OAUTH_ACCOUNT_ID, ["INBOX"]);
	await bindImportedFolders(binder, TARGET_CONFIG_ID, PASSWORD_ACCOUNT_ID);

	assert.equal(store.imports[0].state, "Complete");
	assert.equal(store.imports[0].completedAt, NOW);
	assert.equal(pendingImportOf(store.imports), undefined);
	assert.equal(
		store.settings.get(
			composeFolderRoleAppointmentName(PASSWORD_ACCOUNT_ID, "Sent"),
		)?.value.kind,
		"String",
	);
	const lists = store.mailboxes.find(
		(mailbox) => mailbox.fullPath === "INBOX.Lists.dev-null",
	);
	assert.equal(
		store.settings.get(`MailboxDisplayName#${lists?.mailboxId}`)?.value.value,
		"dev/null",
	);
});

test("an import with no folders to wait for is complete the moment it lands", async () => {
	const document = await exportSource();
	const store = emptyStore();
	store.accounts.push(
		makeAccount({
			accountId: PASSWORD_ACCOUNT_ID,
			accountConfigId: TARGET_CONFIG_ID,
		}),
		makeAccount({
			accountId: OAUTH_ACCOUNT_ID,
			accountConfigId: TARGET_CONFIG_ID,
			email: "work@example.com",
			username: "work@example.com",
			authType: "oauthMicrosoft",
		}),
	);
	discover(store, PASSWORD_ACCOUNT_ID, [
		"INBOX",
		"INBOX.Sent",
		"INBOX.Facturen",
		"INBOX.Lists.dev-null",
	]);
	discover(store, OAUTH_ACCOUNT_ID, ["INBOX"]);

	const report = reportOf(await apply(store, document, "merge"));

	assert.deepEqual(report.warnings, []);
	assert.equal(store.imports[0].state, "Complete");
	assert.equal(
		report.items.filter((item) => item.section === "accounts")[0]?.verdict,
		"updated",
	);
	// A merge onto a live account leaves the credential it already has alone.
	assert.equal(
		store.accounts.find((account) => account.accountId === PASSWORD_ACCOUNT_ID)
			?.isActive,
		true,
	);
});

test("a file carrying a credential is refused, not stripped", async () => {
	const document = (await exportSource()) as unknown as {
		accounts: Record<string, unknown>[];
	};
	document.accounts[0].password = "hunter2";
	const store = emptyStore();

	const report = reportOf(await apply(store, document));

	assert.equal(report.valid, false);
	assert.equal(report.applied, false);
	assert.equal(report.errors[0]?.code, "CredentialPresent");
	assert.match(report.errors[0]?.message ?? "", /never carries one/);
	assert.deepEqual(store.accounts, []);
});

test("a document written by a newer reader is refused with its own version named", async () => {
	const store = emptyStore();
	const report = reportOf(
		await apply(store, {
			kind: "reader.config",
			schemaVersion: 99,
			generator: {
				app: "reader",
				version: "v9",
				exportedAt: IDENTITY.exportedAt,
			},
		}),
	);

	assert.equal(report.valid, false);
	assert.equal(report.schemaVersion, 99);
	assert.equal(report.errors[0]?.code, "UnsupportedVersion");
});

test("a document that is not a reader configuration is refused", async () => {
	const store = emptyStore();
	const report = reportOf(await apply(store, "not a document"));

	assert.equal(report.valid, false);
	assert.equal(report.schemaVersion, 0);
	assert.equal(report.errors[0]?.code, "NotAnObject");
});

test("a document naming the same label twice is refused before anything is written", async () => {
	const document = (await exportSource()) as unknown as {
		labels: { name: string; color: string }[];
	};
	document.labels.push({ name: "facturen", color: "Green" });
	const store = emptyStore();

	const report = reportOf(await apply(store, document));

	assert.equal(report.valid, false);
	assert.equal(report.errors[0]?.code, "duplicate_key");
	assert.deepEqual(store.labels, []);
});

test("a filter pointing at a label no one has is refused", async () => {
	const document = (await exportSource()) as unknown as {
		labels: unknown[];
		filters: { actionLabelName: string | null }[];
	};
	document.labels = [];
	const store = emptyStore();

	const report = reportOf(await apply(store, document));

	assert.equal(report.valid, false);
	assert.deepEqual(
		report.errors.map((error) => error.code),
		["unknown_label"],
	);
});

test("a filter filing into an account the file does not carry is refused", async () => {
	const document = (await exportSource()) as unknown as {
		filters: {
			actionFolder: { accountId: string; folderPath: string } | null;
		}[];
	};
	document.filters[0].actionFolder = {
		accountId: "zzzzzzzzzzzzzzzzzzzzzzzzz",
		folderPath: "INBOX",
	};
	const store = emptyStore();

	const report = reportOf(await apply(store, document));

	assert.equal(report.valid, false);
	assert.equal(report.errors[0]?.code, "unknown_account");
});

test("an anchor this deployment cannot embed is stored as text for the repair to pick up", async () => {
	const document = await exportSource();
	const store = emptyStore();

	const outcome = await importConfig(depsOf(store, TARGET_CONFIG_ID, false), {
		accountConfigId: TARGET_CONFIG_ID,
		userId: TARGET_USER_ID,
		document,
		mode: "apply",
		onExisting: "abort",
	});
	const report = reportOf(outcome);

	const anchor = store.anchors[0];
	assert.equal(anchor.anchorEmbeddingId, ANCHOR_EMBEDDING_PENDING);
	assert.deepEqual(anchor.anchorEmbedding, []);
	assert.equal(
		anchor.anchorSourceText,
		"the release note this filter was drawn from",
	);
	assert.equal(
		report.warnings.some((warning) => warning.code === "anchor_not_embedded"),
		true,
	);
});

test("a write that fails after validation leaves nothing behind and names where it stopped", async () => {
	const document = await exportSource();
	const store = emptyStore();
	store.failOn = "filter";

	const report = reportOf(await apply(store, document));

	assert.equal(report.valid, true);
	assert.equal(report.applied, false);
	assert.equal(report.errors[0]?.code, "import_write_failed");
	assert.equal(report.errors[0]?.details?.section, "filters");
	assert.equal(report.items[0]?.verdict, "rejected");
	assert.deepEqual(store.imports, []);
});

test("the configuration row is created when the database holds none, and named from the file", async () => {
	const document = await exportSource();
	const store = emptyStore();

	await apply(store, document);

	assert.equal(store.accountConfigs.get(TARGET_CONFIG_ID)?.name, "Matthijs");
	assert.equal(
		store.accountConfigs.get(TARGET_CONFIG_ID)?.userId,
		TARGET_USER_ID,
	);
	assert.equal(
		store.settings.get("DefaultComposerFormat")?.value.value,
		"markdown",
	);
	assert.deepEqual(store.settings.get("PinnedFolders")?.value.value, [
		"INBOX",
		"INBOX.Facturen",
	]);
	assert.equal(
		store.settings.get(`AccountSignatureHtml#${PASSWORD_ACCOUNT_ID}`)?.value
			.value,
		"<p>Matthijs</p>",
	);
});

test("a second import of the same file over the same configuration changes nothing new", async () => {
	const document = await exportSource();
	const store = emptyStore();

	await apply(store, document);
	const accounts = store.accounts.length;
	const labels = store.labels.length;
	const filters = store.filters.length;

	const report = reportOf(await apply(store, document, "merge"));

	assert.equal(store.accounts.length, accounts);
	assert.equal(store.labels.length, labels);
	assert.equal(store.filters.length, filters);
	assert.equal(
		report.items.every((item) => item.verdict === "updated"),
		true,
	);
});

test("a binder run on a configuration with no import does nothing", async () => {
	const store = emptyStore();
	const result = await bindImportedFolders(
		{
			repositories: repositoriesOf(store, TARGET_CONFIG_ID),
			appointFolderRole: appointFolderRoleInto(store),
		},
		TARGET_CONFIG_ID,
		PASSWORD_ACCOUNT_ID,
	);
	assert.deepEqual(result, { bound: 0, stillPending: 0 });
	assert.equal(pendingImportOf([]), undefined);
});
