/**
 * One exported configuration from a Dutch household setup — a personal domain
 * over IMAP, a work account on Microsoft 365, and a consultancy address —
 * carried into a second instance. Realistic enough that the dry-run report has
 * something to say in every verdict, and shaped exactly as
 * `POST /config/import` answers, so the stories render what the app renders.
 */

import type {
	ApiError,
	RemitImapConfigImportItemReport,
	RemitImapConfigImportReport,
} from "@remit/api-http-client/types.gen.ts";
import type { ImportedAccount } from "./steps";

export const CONFIG_FILE_NAME = "reader-config.ischen.json";

const item = (
	section: string,
	key: string,
	verdict: string,
	reason?: string,
): RemitImapConfigImportItemReport => ({ section, key, verdict, reason });

export const mixedItems: RemitImapConfigImportItemReport[] = [
	item("accounts", "matthijs@ischen.nl", "created"),
	item("accounts", "m.vanhenten@gemeente-amstelveen.nl", "created"),
	item("accounts", "post@vanhenten-advies.nl", "updated"),
	item(
		"accounts",
		"matthijs@xs4all.nl",
		"skipped",
		"An account with this address already exists here and its server settings differ. Remove it first, or edit it by hand — importing will not overwrite a working account.",
	),
	item("labels", "Facturen", "created"),
	item("labels", "Raadsstukken", "unchanged"),
	item("filters", "Bonnetjes", "created"),
	item("filters", "Nieuwsbrieven dempen", "created"),
	item(
		"filters",
		"Waternet",
		"skipped",
		"The folder this rule files into is not here yet. The rule is imported switched off and turns itself on once Projecten/Waternet appears.",
	),
	item("filters", "Raadsstukken markeren", "updated"),
	item(
		"filters",
		"Oude spamregel",
		"rejected",
		"This rule uses an action this version does not have (moveToServerRule). Nothing was imported for it. Rebuild the rule in Settings › Filters.",
	),
	item("addressFlags", "anouk@waternet.nl", "created"),
	item("addressFlags", "nieuwsbrief@bol.com", "created"),
	item("addressFlags", "no-reply@promo.example", "unchanged"),
	item("settings", "Density", "updated"),
	item("settings", "Theme", "unchanged"),
	item("settings", "PinnedFolders", "created"),
	item("settings", "FolderRoleAppointment#Archive", "created"),
];

/** A fresh install: nothing here to skip, nothing to reject. */
export const cleanItems: RemitImapConfigImportItemReport[] = mixedItems
	.filter((entry) => entry.verdict !== "rejected")
	.map((entry) => ({
		section: entry.section,
		key: entry.key,
		verdict: "created",
	}));

const warning = (
	code: string,
	message: string,
	details: Record<string, string>,
): ApiError => ({ code, message, details });

export const folderWarnings: ApiError[] = [
	warning(
		"folder_not_found_yet",
		'Filter "Waternet" files mail into "Projecten/Waternet", which this account does not hold yet. It is bound once the folder list has been read.',
		{ filter: "Waternet", folderPath: "Projecten/Waternet" },
	),
	warning(
		"folder_not_found_yet",
		'Filter "Aangifte bewaren" files mail into "Archief/Belasting 2025", which this account does not hold yet. It is bound once the folder list has been read.',
		{ filter: "Aangifte bewaren", folderPath: "Archief/Belasting 2025" },
	),
	warning(
		"folder_not_found_yet",
		'"Raadsstukken" is not a folder this account holds yet. It is bound once the folder list has been read.',
		{ folderPath: "Raadsstukken", accountId: "acct-amstelveen" },
	),
];

const report = (
	overrides: Partial<RemitImapConfigImportReport>,
): RemitImapConfigImportReport => ({
	valid: true,
	schemaVersion: 1,
	applied: false,
	items: mixedItems,
	errors: [],
	warnings: [],
	accountsNeedingCredentials: [],
	...overrides,
});

export const dryRunReport = report({ warnings: folderWarnings });

export const cleanRunReport = report({ items: cleanItems });

export const rejectedReports: Record<string, RemitImapConfigImportReport> = {
	wrongKind: report({
		valid: false,
		schemaVersion: 0,
		items: [],
		errors: [
			{
				code: "WrongKind",
				message:
					'Not a reader configuration document: expected kind "reader.config", found "photo-album".',
			},
		],
	}),
	newerSchema: report({
		valid: false,
		schemaVersion: 5,
		items: [],
		errors: [
			{
				code: "UnsupportedVersion",
				message:
					"Document schemaVersion 5 was written by a newer reader; this one reads up to 1. Upgrade before importing.",
			},
		],
	}),
	unknownKey: report({
		valid: false,
		items: [],
		errors: [
			{
				code: "UnknownKeys",
				message:
					"Unknown keys at filters[3]: serverSideCopy, retentionDays. A document this reader does not fully understand is refused rather than partly applied.",
			},
		],
	}),
	credentialField: report({
		valid: false,
		items: [],
		errors: [
			{
				code: "CredentialPresent",
				message:
					"Credential field at accounts[1]: imapPassword. A configuration document declares which credential an account needs; it never carries one.",
			},
		],
	}),
};

export const partialImportReport: RemitImapConfigImportReport = report({
	applied: true,
	items: [
		...mixedItems.filter(
			(entry) => entry.section === "accounts" || entry.section === "labels",
		),
		item(
			"filters",
			"Bonnetjes",
			"rejected",
			"the filter store refused the write",
		),
	],
	errors: [
		{
			code: "import_write_failed",
			message:
				"the filter store refused the write The items above it were written and remain; the import stopped here.",
			details: { section: "filters", key: "Bonnetjes" },
		},
	],
	warnings: folderWarnings,
});

export const importedAccounts: ImportedAccount[] = [
	{
		accountId: "acct-ischen",
		address: "matthijs@ischen.nl",
		displayName: "Matthijs van Henten",
		connector: "imap",
		server: "imap.ischen.nl:993",
		state: "entered",
	},
	{
		accountId: "acct-advies",
		address: "post@vanhenten-advies.nl",
		displayName: "Van Henten Advies",
		connector: "imap",
		server: "mail.antagonist.nl:993",
		state: "needed",
	},
	{
		accountId: "acct-amstelveen",
		address: "m.vanhenten@gemeente-amstelveen.nl",
		displayName: "M. van Henten (Gemeente Amstelveen)",
		connector: "microsoft",
		server: "outlook.office365.com",
		state: "needed",
	},
];

export const accountsAllPending: ImportedAccount[] = importedAccounts.map(
	(account) => ({ ...account, state: "needed" as const }),
);

export const accountsAllConnected: ImportedAccount[] = importedAccounts.map(
	(account) => ({ ...account, state: "entered" as const }),
);

export const accountsOneFailed: ImportedAccount[] = importedAccounts.map(
	(account) =>
		account.accountId === "acct-advies"
			? {
					...account,
					state: "failed" as const,
					failure:
						"535 5.7.8 Authentication credentials invalid — Antagonist wants the mailbox password, not your control-panel login.",
				}
			: account,
);
