/**
 * Config import/export fixtures: one exported file from a Dutch household
 * setup — a personal domain over IMAP, a work account on Microsoft 365, and a
 * consultancy address — carried into a second instance. Realistic enough that
 * the dry-run report has something to say in every verdict.
 */

export type Verdict =
	| "created"
	| "updated"
	| "unchanged"
	| "skipped"
	| "rejected";

export interface ConfigEntry {
	id: string;
	label: string;
	detail: string;
	verdict: Verdict;
	/** Why it will not land, and what to do about it. Set for skipped/rejected. */
	reason?: string;
}

export interface ConfigSection {
	id: string;
	title: string;
	entries: ConfigEntry[];
}

export interface ConfigFile {
	name: string;
	size: string;
	schemaVersion: string;
	writtenBy: string;
	writtenAt: string;
	host: string;
}

export const configFile: ConfigFile = {
	name: "reader-config.ischen.json",
	size: "18 kB",
	schemaVersion: "3",
	writtenBy: "Reader 1.4.2",
	writtenAt: "12 augustus 2026, 21:40",
	host: "mail.ischen.nl",
};

export const verdictLabels: Record<Verdict, string> = {
	created: "created",
	updated: "updated",
	unchanged: "unchanged",
	skipped: "skipped",
	rejected: "rejected",
};

export const accountsSection: ConfigSection = {
	id: "accounts",
	title: "Accounts",
	entries: [
		{
			id: "ischen",
			label: "matthijs@ischen.nl",
			detail: "IMAP imap.ischen.nl:993 · SMTP smtp.ischen.nl:587 · STARTTLS",
			verdict: "created",
		},
		{
			id: "amstelveen",
			label: "m.vanhenten@gemeente-amstelveen.nl",
			detail: "Microsoft 365 · Outlook.office365.com",
			verdict: "created",
		},
		{
			id: "advies",
			label: "post@vanhenten-advies.nl",
			detail: "IMAP mail.antagonist.nl:993 · SMTP smtp.antagonist.nl:587",
			verdict: "updated",
		},
		{
			id: "oud",
			label: "matthijs@xs4all.nl",
			detail: "IMAP imap.xs4all.nl:993",
			verdict: "skipped",
			reason:
				"An account with this address already exists here and its server settings differ. Remove it first, or edit it by hand — importing will not overwrite a working account.",
		},
	],
};

export const foldersSection: ConfigSection = {
	id: "folders",
	title: "Folders & roles",
	entries: [
		{
			id: "postvak-in",
			label: "Postvak IN → Inbox",
			detail: "matthijs@ischen.nl · role appointed by the server",
			verdict: "unchanged",
		},
		{
			id: "verzonden",
			label: "Verzonden items → Sent",
			detail: "matthijs@ischen.nl · role appointed by this config",
			verdict: "created",
		},
		{
			id: "prullenbak",
			label: "Prullenbak → Trash",
			detail: "matthijs@ischen.nl",
			verdict: "created",
		},
		{
			id: "ongewenst",
			label: "Ongewenste e-mail → Junk",
			detail: "m.vanhenten@gemeente-amstelveen.nl",
			verdict: "created",
		},
		{
			id: "facturen",
			label: "Archief/Facturen 2026",
			detail: "post@vanhenten-advies.nl · no role, plain folder",
			verdict: "unchanged",
		},
		{
			id: "waternet",
			label: "Projecten/Waternet",
			detail: "post@vanhenten-advies.nl",
			verdict: "skipped",
			reason:
				"This folder does not exist on the server yet. It will be picked up on the next full folder discovery, or create it in your mail client and import again.",
		},
	],
};

export const rulesSection: ConfigSection = {
	id: "rules",
	title: "Rules & filters",
	entries: [
		{
			id: "bonnetjes",
			label: "Bonnetjes → Archief/Facturen 2026",
			detail: "From bol.com, coolblue.nl, ns.nl · file, mark read",
			verdict: "created",
		},
		{
			id: "nieuwsbrieven",
			label: "Nieuwsbrieven dempen",
			detail: "List-Unsubscribe present · skip inbox, keep unread",
			verdict: "created",
		},
		{
			id: "waternet-rule",
			label: "Waternet → Projecten/Waternet",
			detail: "From *@waternet.nl · file",
			verdict: "skipped",
			reason:
				"The folder this rule files into is not here yet. The rule is imported switched off and turns itself on once Projecten/Waternet appears.",
		},
		{
			id: "raadsstukken",
			label: "Raadsstukken markeren",
			detail: "Subject contains 'raadsvoorstel' · flag",
			verdict: "updated",
		},
		{
			id: "legacy",
			label: "Oude spamregel",
			detail: "action: moveToServerRule",
			verdict: "rejected",
			reason:
				"This rule uses an action this version does not have (moveToServerRule). Nothing was imported for it. Rebuild the rule in Settings → Senders & Rules.",
		},
	],
};

export const sendersSection: ConfigSection = {
	id: "senders",
	title: "Senders",
	entries: [
		{
			id: "vip",
			label: "6 VIP senders",
			detail: "anouk@waternet.nl, j.dekker@gemeente-amstelveen.nl, +4",
			verdict: "created",
		},
		{
			id: "muted",
			label: "23 muted senders",
			detail: "nieuwsbrief@bol.com, deals@coolblue.nl, +21",
			verdict: "created",
		},
		{
			id: "blocked",
			label: "4 blocked senders",
			detail: "no-reply@promo.example, aanbieding@spam.example, +2",
			verdict: "unchanged",
		},
	],
};

export const preferencesSection: ConfigSection = {
	id: "preferences",
	title: "Appearance & shortcuts",
	entries: [
		{
			id: "density",
			label: "Density: comfortable",
			detail: "was: compact",
			verdict: "updated",
		},
		{
			id: "theme",
			label: "Theme: follow system",
			detail: "unchanged from this instance",
			verdict: "unchanged",
		},
		{
			id: "reading-pane",
			label: "Reading pane: right",
			detail: "was: bottom",
			verdict: "updated",
		},
		{
			id: "shortcuts",
			label: "9 custom shortcuts",
			detail: "j/k navigation, e archive, # trash",
			verdict: "created",
		},
	],
};

export const dryRunSections: ConfigSection[] = [
	accountsSection,
	foldersSection,
	rulesSection,
	sendersSection,
	preferencesSection,
];

/** Nothing here yet but a fresh install, so every section is a clean create. */
export const cleanRunSections: ConfigSection[] = dryRunSections.map(
	(section) => ({
		...section,
		entries: section.entries
			.filter((entry) => entry.verdict !== "rejected")
			.map((entry) =>
				entry.verdict === "skipped" || entry.verdict === "unchanged"
					? { ...entry, verdict: "created" as Verdict, reason: undefined }
					: entry,
			),
	}),
);

export function countVerdicts(
	sections: ConfigSection[],
): Record<Verdict, number> {
	const counts: Record<Verdict, number> = {
		created: 0,
		updated: 0,
		unchanged: 0,
		skipped: 0,
		rejected: 0,
	};
	for (const section of sections) {
		for (const entry of section.entries) counts[entry.verdict] += 1;
	}
	return counts;
}

export type CredentialState = "needed" | "entered" | "failed";

export interface ImportedAccount {
	id: string;
	address: string;
	displayName: string;
	connector: "imap" | "microsoft";
	server: string;
	state: CredentialState;
	/** What went wrong on the last attempt, and the likely fix. */
	failure?: string;
}

export const importedAccounts: ImportedAccount[] = [
	{
		id: "ischen",
		address: "matthijs@ischen.nl",
		displayName: "Matthijs van Henten",
		connector: "imap",
		server: "imap.ischen.nl:993",
		state: "entered",
	},
	{
		id: "advies",
		address: "post@vanhenten-advies.nl",
		displayName: "Van Henten Advies",
		connector: "imap",
		server: "mail.antagonist.nl:993",
		state: "needed",
	},
	{
		id: "amstelveen",
		address: "m.vanhenten@gemeente-amstelveen.nl",
		displayName: "M. van Henten (Gemeente Amstelveen)",
		connector: "microsoft",
		server: "outlook.office365.com",
		state: "needed",
	},
];

export const accountsAllPending: ImportedAccount[] = importedAccounts.map(
	(account) => ({ ...account, state: "needed" as CredentialState }),
);

export const accountsOneFailed: ImportedAccount[] = importedAccounts.map(
	(account) =>
		account.id === "advies"
			? {
					...account,
					state: "failed" as CredentialState,
					failure:
						"535 5.7.8 Authentication credentials invalid — Antagonist wants the mailbox password, not your control-panel login.",
				}
			: account,
);

export interface PendingFolder {
	path: string;
	account: string;
	waitingFor: string;
}

export const pendingFolders: PendingFolder[] = [
	{
		path: "Projecten/Waternet",
		account: "post@vanhenten-advies.nl",
		waitingFor: "Rule “Waternet → Projecten/Waternet”",
	},
	{
		path: "Archief/Belasting 2025",
		account: "post@vanhenten-advies.nl",
		waitingFor: "Rule “Aangifte bewaren”",
	},
	{
		path: "Raadsstukken",
		account: "m.vanhenten@gemeente-amstelveen.nl",
		waitingFor: "Folder role: appointed as Archive",
	},
];

export type ImportFailure =
	| "wrong-kind"
	| "newer-schema"
	| "unknown-key"
	| "credential-field";

export interface FailureCopy {
	title: string;
	explanation: string;
	fix: string;
	raw: string;
}

export const importFailures: Record<ImportFailure, FailureCopy> = {
	"wrong-kind": {
		title: "That is not a Reader config file",
		explanation:
			"vakantiefotos.json parses as JSON but has none of the keys a Reader config carries — no schemaVersion, no accounts.",
		fix: "Export one from Settings → Advanced on the instance you are moving from, or run `remit config save`.",
		raw: 'expected object with "schemaVersion" and "accounts", found keys: albums, takenAt',
	},
	"newer-schema": {
		title: "This file was written by a newer Reader",
		explanation:
			"The file declares schemaVersion 5. This instance reads up to 3, so importing it would drop settings it cannot understand.",
		fix: "Update this Reader to 1.6 or later, then import again. The file is unchanged and safe to keep.",
		raw: "schemaVersion 5 > supported 3 (written by Reader 1.6.0)",
	},
	"unknown-key": {
		title: "The file contains settings this version does not know",
		explanation:
			"Two keys under rules[3] are not part of schemaVersion 3. Importing them would silently do nothing, so nothing was imported.",
		fix: "Update this Reader, or remove `serverSideCopy` and `retentionDays` from the file and import again.",
		raw: 'unknown keys at rules[3]: "serverSideCopy", "retentionDays"',
	},
	"credential-field": {
		title: "The file carries a password",
		explanation:
			"accounts[1] has an `imapPassword` field. A config file is meant to be shareable, so Reader refuses it rather than importing around it — the password may now be in your backups, your chat history, or a pull request.",
		fix: "Delete the field from the file and import again, then change that mailbox password. Exports written by Reader never contain one.",
		raw: 'credential field at accounts[1]: "imapPassword"',
	},
};

export interface PartialResult {
	section: string;
	state: "landed" | "failed" | "not-attempted";
	detail: string;
}

export const partialResults: PartialResult[] = [
	{
		section: "Accounts",
		state: "landed",
		detail: "3 accounts created — they are in Settings now, without passwords.",
	},
	{
		section: "Folders & roles",
		state: "landed",
		detail: "8 roles appointed across 3 accounts.",
	},
	{
		section: "Rules & filters",
		state: "failed",
		detail:
			"Failed on rule 4 of 11 (“Bonnetjes”). The first three landed and are active; rules 4 to 11 were not written.",
	},
	{
		section: "Senders",
		state: "not-attempted",
		detail: "Not attempted — the import stopped before this section.",
	},
	{
		section: "Appearance & shortcuts",
		state: "not-attempted",
		detail: "Not attempted — the import stopped before this section.",
	},
];

export const partialFailureRaw =
	"500 Internal Server Error — POST /config/import: rule store rejected write (constraint rules_name_account_unique)";

export const exportFileName = "reader-config.2026-08-27.json";

export const exportContents =
	"3 accounts, 21 folder roles, 11 rules, 33 senders, appearance and shortcuts. No passwords, no OAuth tokens.";
