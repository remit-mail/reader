import assert from "node:assert/strict";
import { test } from "node:test";
import { ReaderConfigDocumentSchema } from "@remit/config-format";
import type { AccountItem, AddressItem } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import {
	composeFolderRoleAppointmentLabelName,
	composeFolderRoleAppointmentName,
} from "@remit/data-ports/folder-role";
import { MessageCategory } from "@remit/domain-enums";
import { readConfigForExport } from "./export.js";
import {
	ACCOUNT_CONFIG_ID,
	asRepositories,
	type ConfigFixture,
	listableForSuggestions,
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

const IDENTITY = {
	app: "reader",
	version: "v0.1.0",
	exportedAt: "2026-08-27T09:15:00+02:00",
	instance: "reader.ischen.nl",
};

const INBOX_ID = "mbx-inbox";
const SENT_ID = "mbx-sent";
const INVOICES_ID = "mbx-invoices";
const LISTS_ID = "mbx-lists";
const OAUTH_INBOX_ID = "mbx-oauth-inbox";

const passwordAccount = (): AccountItem =>
	makeAccount({ accountId: PASSWORD_ACCOUNT_ID });

const oauthAccount = (): AccountItem =>
	makeAccount({
		accountId: OAUTH_ACCOUNT_ID,
		email: "work@example.com",
		username: "work@example.com",
		authType: "oauthMicrosoft",
		imapHost: "outlook.office365.com",
		smtpEnabled: false,
		smtpHost: "",
	});

const fullFixture = (): ConfigFixture => ({
	accountConfig: makeAccountConfig(),
	accounts: [passwordAccount(), oauthAccount()],
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
		// One list for the whole configuration, which is how the registry spells
		// it — INBOX.Werk is on neither account and INBOX is on both.
		makeSetting("PinnedFolders", {
			kind: "StringList",
			value: ["INBOX", "INBOX.Facturen", "INBOX.Werk"],
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
		// A tombstone row, a configuration-wide setting this export does not
		// carry, and a recorded path for a role nobody appointed: all three are
		// passed over rather than refused.
		makeSetting("MailboxRole#mbx-gone", { kind: "String", value: "Archive" }),
		makeSetting("Theme", { kind: "String", value: "dark" }),
		makeSetting(
			composeFolderRoleAppointmentLabelName(PASSWORD_ACCOUNT_ID, "Archive"),
			{ kind: "String", value: "INBOX.Archief" },
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
					expiresAt: 1790000000000,
					reason: "unsubscribe link never worked",
				},
			},
		}),
	],
	addressPageSize: 1,
});

const exportFixture = (fixture: ConfigFixture) =>
	readConfigForExport(asRepositories(fixture), ACCOUNT_CONFIG_ID, IDENTITY);

test("a configuration exports as a document the v1 schema accepts", async () => {
	const document = await exportFixture(fullFixture());

	assert.equal(ReaderConfigDocumentSchema.safeParse(document).success, true);
	assert.equal(document.kind, "reader.config");
	assert.equal(document.schemaVersion, 1);
	assert.deepEqual(document.provenance, {
		accountConfigId: ACCOUNT_CONFIG_ID,
		instance: "reader.ischen.nl",
	});
	assert.equal(document.accountConfig.name, "Matthijs");
	assert.equal(document.accountConfig.defaultComposerFormat, "markdown");
});

test("no credential field is emitted, for either authentication type", async () => {
	const document = await exportFixture(fullFixture());

	const forbidden = [
		"password",
		"passwordHash",
		"smtpPassword",
		"smtpPasswordHash",
		"oauthRefreshToken",
		"oauthRefreshTokenHash",
		"oauthTokenUpdatedAt",
	];
	assert.equal(document.accounts.length, 2);
	for (const account of document.accounts) {
		for (const key of forbidden) {
			// Structural absence, not a blank: `in` fails on an emitted empty string.
			assert.equal(key in account, false, `${key} reached the document`);
			assert.equal(key in account.imap, false);
			assert.equal(key in account.smtp, false);
			assert.equal(key in account.credentials, false);
		}
	}
});

test("each account declares the credential it will need back", async () => {
	const document = await exportFixture(fullFixture());
	const [password, oauth] = document.accounts;

	assert.deepEqual(password?.credentials, { required: "password" });
	assert.deepEqual(oauth?.credentials, {
		required: "oauth",
		provider: "microsoft",
	});
});

test("a stored credential never survives the read", async () => {
	const fixture = fullFixture();
	fixture.accounts = [
		makeAccount({
			accountId: PASSWORD_ACCOUNT_ID,
			passwordHash: "enc:v1:not-a-real-secret",
			smtpPasswordHash: "enc:v1:not-a-real-secret-either",
		}),
		makeAccount({
			accountId: OAUTH_ACCOUNT_ID,
			email: "work@example.com",
			username: "work@example.com",
			authType: "oauthMicrosoft",
			oauthRefreshTokenHash: "enc:v1:not-a-real-token",
			oauthTokenUpdatedAt: 1750000000,
		}),
	];

	const document = await exportFixture(fixture);

	assert.equal(JSON.stringify(document).includes("not-a-real"), false);
});

test("a deleted account is left behind", async () => {
	const fixture = fullFixture();
	fixture.accounts = [
		passwordAccount(),
		makeAccount({ accountId: OAUTH_ACCOUNT_ID, deletedAt: 1756281600000 }),
	];

	const document = await exportFixture(fixture);

	assert.deepEqual(
		document.accounts.map((account) => account.accountId),
		[PASSWORD_ACCOUNT_ID],
	);
});

test("the account id travels verbatim", async () => {
	const document = await exportFixture(fullFixture());

	assert.deepEqual(
		document.accounts.map((account) => account.accountId),
		[PASSWORD_ACCOUNT_ID, OAUTH_ACCOUNT_ID],
	);
});

test("per-account settings land on the account that holds them", async () => {
	const document = await exportFixture(fullFixture());
	const [password, oauth] = document.accounts;

	assert.equal(password?.displayName, "Matthijs van Henten");
	assert.deepEqual(password?.composeLanguages, ["nl-NL", "en-GB"]);
	assert.deepEqual(password?.signature, {
		plainText: "Matthijs\n",
		html: "<p>Matthijs</p>",
	});
	assert.equal(password?.muted, null);

	assert.equal(oauth?.displayName, "");
	assert.deepEqual(oauth?.composeLanguages, []);
	assert.deepEqual(oauth?.signature, { plainText: "", html: "" });
	assert.equal(oauth?.muted?.value, true);
});

test("a pinned folder lands on each account that holds it, and nowhere else", async () => {
	const document = await exportFixture(fullFixture());
	const [password, oauth] = document.accounts;

	assert.deepEqual(password?.pinnedFolders, ["INBOX", "INBOX.Facturen"]);
	assert.deepEqual(oauth?.pinnedFolders, ["INBOX"]);
});

test("every folder reference travels as an IMAP path", async () => {
	const document = await exportFixture(fullFixture());
	const [password] = document.accounts;

	assert.deepEqual(password?.folderRoles, [
		{ role: "Sent", folderPath: "INBOX.Sent" },
	]);
	assert.deepEqual(password?.folderOverrides, [
		{
			folderPath: "INBOX.Lists.dev-null",
			displayName: "dev/null",
			muted: { value: true, setAt: 1756281600000 },
		},
	]);
	assert.deepEqual(document.filters[0]?.actionFolder, {
		accountId: PASSWORD_ACCOUNT_ID,
		folderPath: "INBOX.Facturen",
	});
});

test("a role whose folder is gone falls back to the path it was appointed on", async () => {
	const fixture = fullFixture();
	fixture.mailboxes = fixture.mailboxes.filter(
		(mailbox) => mailbox.mailboxId !== SENT_ID,
	);

	const document = await exportFixture(fixture);

	assert.deepEqual(document.accounts[0]?.folderRoles, [
		{ role: "Sent", folderPath: "INBOX.Sent" },
	]);
});

test("a role naming a folder nothing can name is dropped", async () => {
	const fixture = fullFixture();
	fixture.mailboxes = fixture.mailboxes.filter(
		(mailbox) => mailbox.mailboxId !== SENT_ID,
	);
	fixture.settings = fixture.settings.filter(
		(setting) =>
			setting.name !==
			composeFolderRoleAppointmentLabelName(PASSWORD_ACCOUNT_ID, "Sent"),
	);

	const document = await exportFixture(fixture);

	assert.deepEqual(document.accounts[0]?.folderRoles, []);
});

test("an override on a folder that no longer exists is dropped", async () => {
	const fixture = fullFixture();
	fixture.mailboxes = fixture.mailboxes.filter(
		(mailbox) => mailbox.mailboxId !== LISTS_ID,
	);

	const document = await exportFixture(fixture);

	assert.deepEqual(document.accounts[0]?.folderOverrides, []);
});

test("a filter names its label and its folder, never their ids", async () => {
	const document = await exportFixture(fullFixture());
	const [invoices, semantic] = document.filters;

	assert.equal(invoices?.actionLabelName, "Facturen");
	assert.equal(invoices?.matchOperator, "Or");
	assert.deepEqual(invoices?.literalClauses, [
		{ field: "Subject", value: "factuur" },
		{ field: "FromDomain", value: "moneybird.com" },
	]);
	assert.equal(invoices?.expiresAt, null);
	assert.equal(invoices?.anchor, null);

	assert.equal(semantic?.actionLabelName, null);
	assert.equal(semantic?.actionFolder, null);
	assert.equal(semantic?.expiresAt, "2026-12-31T23:59:59+01:00");
});

test("a filter action naming something that is gone exports as no action", async () => {
	const fixture = fullFixture();
	fixture.labels = [];
	fixture.mailboxes = fixture.mailboxes.filter(
		(mailbox) => mailbox.mailboxId !== INVOICES_ID,
	);

	const document = await exportFixture(fixture);

	assert.equal(document.filters[0]?.actionLabelName, null);
	assert.equal(document.filters[0]?.actionFolder, null);
});

test("an anchor exports its text and its provenance, never its vector", async () => {
	const document = await exportFixture(fullFixture());

	assert.deepEqual(document.filters[1]?.anchor, {
		sourceText: "the release note this filter was drawn from",
		embeddingId: "amazon.titan-embed-text-v2:0@1024",
		sourceMessageId: "2c9e4b117d5a4f609a315b8c0",
	});
	assert.equal(JSON.stringify(document).includes("anchorEmbedding"), false);
	assert.equal(JSON.stringify(document).includes("0.22"), false);
});

test("a filter claiming an anchor it has no row for exports without one", async () => {
	// hasAnchor is a cache of whether the sibling row exists, and a write that
	// failed after the filter landed leaves it saying yes over nothing. The
	// export answers with the rows it can read, never with the flag.
	const fixture = fullFixture();
	fixture.anchors = [];

	const document = await exportFixture(fixture);

	assert.equal(document.filters[1]?.anchor, null);
	assert.equal(ReaderConfigDocumentSchema.safeParse(document).success, true);
});

test("labels export by name and colour", async () => {
	const document = await exportFixture(fullFixture());

	assert.deepEqual(document.labels, [
		{ name: "Facturen", color: "Blue" },
		{ name: "Te lezen", color: "Default" },
	]);
});

test("an address exports only when the user decided something about it", async () => {
	const fixture = fullFixture();
	const derivedOnly: AddressItem[] = [
		makeAddress({ addressId: "adr-bare", normalizedEmail: "bare@example.com" }),
		makeAddress({
			addressId: "adr-wellknown",
			normalizedEmail: "known@example.com",
			flags: { wellknown: { value: true, setAt: 1750000000000 } },
		}),
		makeAddress({
			addressId: "adr-junk",
			normalizedEmail: "junk@example.com",
			flags: { junkOnly: { value: true, setAt: 1750000000000 } },
		}),
		makeAddress({
			addressId: "adr-both",
			normalizedEmail: "both@example.com",
			flags: {
				wellknown: { value: true, setAt: 1750000000000 },
				junkOnly: { value: true, setAt: 1750000000000 },
			},
		}),
	];
	fixture.addresses = [...derivedOnly, ...fixture.addresses];

	const document = await exportFixture(fixture);

	assert.deepEqual(
		document.addressFlags.map((entry) => entry.normalizedEmail),
		["post@bank.example", "noreply@newsletter.example"],
	);
});

test("a junk-only address the user unsubscribed from still exports", async () => {
	// The shape the autocomplete listing withholds: junk-only, never
	// corresponded with, never judged. The reader still decided something about
	// it, so it belongs in the file (#1029).
	const swallowed = makeAddress({
		addressId: "adr-swallowed",
		normalizedEmail: "offers@junkmail.example",
		flags: {
			junkOnly: { value: true, setAt: 1750000000000 },
			unsubscribed: { value: true, setAt: 1755000000000 },
		},
	});
	assert.equal(listableForSuggestions(swallowed), false);

	const fixture = fullFixture();
	fixture.addresses = [swallowed, ...fixture.addresses];

	const document = await exportFixture(fixture);

	assert.ok(
		document.addressFlags.some(
			(entry) => entry.normalizedEmail === "offers@junkmail.example",
		),
	);
});

test("every address decision survives paging, whatever its standing", async () => {
	const fixture = fullFixture();
	fixture.addresses = [
		makeAddress({
			addressId: "adr-archive",
			normalizedEmail: "receipts@shop.example",
			flags: {
				junkOnly: { value: true, setAt: 1750000000000 },
				autoArchive: { value: true, setAt: 1750000000000 },
			},
		}),
		makeAddress({
			addressId: "adr-category",
			normalizedEmail: "alerts@bank.example",
			flags: {
				junkOnly: { value: true, setAt: 1750000000000 },
				category: {
					value: MessageCategory.transactional,
					setAt: 1750000000000,
				},
			},
		}),
		...fixture.addresses,
	];
	fixture.addressPageSize = 1;

	const document = await exportFixture(fixture);

	assert.deepEqual(
		document.addressFlags.map((entry) => entry.normalizedEmail).sort(),
		[
			"alerts@bank.example",
			"noreply@newsletter.example",
			"post@bank.example",
			"receipts@shop.example",
		],
	);
});

test("an exported address carries its whole flag payload, and no derived flag", async () => {
	const document = await exportFixture(fullFixture());
	const [bank, newsletter] = document.addressFlags;

	assert.equal(bank?.displayName, "Bank");
	assert.deepEqual(bank?.flags, {
		vip: { value: true, setAt: 1750000000000, setBy: "web-client" },
	});
	assert.equal("wellknown" in (bank?.flags ?? {}), false);

	assert.equal(newsletter?.displayName, "");
	assert.deepEqual(newsletter?.flags.unsubscribed, {
		value: true,
		setAt: 1755000000000,
		expiresAt: 1790000000000,
		reason: "unsubscribe link never worked",
	});
});

test("a configuration that holds no row at all still exports a valid document", async () => {
	const repositories = asRepositories(fullFixture());
	const document = await readConfigForExport(
		{
			...repositories,
			accountConfig: {
				get: async () => {
					throw new NotFoundError("accountConfig not found");
				},
			},
		},
		ACCOUNT_CONFIG_ID,
		IDENTITY,
	);

	assert.equal(ReaderConfigDocumentSchema.safeParse(document).success, true);
	assert.equal(document.accountConfig.name, "");
});

test("a read failure that is not a missing row propagates", async () => {
	const repositories = asRepositories(fullFixture());

	await assert.rejects(
		readConfigForExport(
			{
				...repositories,
				accountConfig: {
					get: async () => {
						throw new Error("the database is gone");
					},
				},
			},
			ACCOUNT_CONFIG_ID,
			IDENTITY,
		),
		/the database is gone/,
	);
});

test("a configuration with nothing in it still exports a valid document", async () => {
	const document = await exportFixture({
		accountConfig: makeAccountConfig({ name: undefined }),
		accounts: [],
		settings: [],
		mailboxes: [],
		labels: [],
		filters: [],
		anchors: [],
		addresses: [],
	});

	assert.equal(ReaderConfigDocumentSchema.safeParse(document).success, true);
	assert.equal(document.accountConfig.name, "");
	assert.equal(document.accountConfig.defaultComposerFormat, undefined);
	assert.deepEqual(document.accounts, []);
	assert.deepEqual(document.addressFlags, []);
});
