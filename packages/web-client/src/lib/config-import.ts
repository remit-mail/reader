/**
 * What a config import report means on screen (#1021).
 *
 * `POST /config/import` answers with one flat report: per-item verdicts, a list
 * of blocking errors and a list of non-blocking warnings, each keyed by a code.
 * The screens group that into sections, and turn a code into copy that says
 * what failed and what to do about it. Nothing here touches the network or the
 * DOM, so every branch the wizard can land in is decidable in a unit test.
 */

import type {
	ApiError,
	RemitImapConfigImportItemReport,
	RemitImapConfigImportReport,
} from "@remit/api-http-client/types.gen.ts";
// `ApiError` above is the wire model for an error body; this is the thrown
// wrapper `lib/client.ts` puts every HTTP failure in.
import { ApiError as ThrownApiError } from "./api.js";
import { getErrorStatus } from "./error-classifier.js";
import { safeJsonParse } from "./json.js";

export const IMPORT_SECTION_ORDER = [
	"accounts",
	"labels",
	"filters",
	"addressFlags",
	"settings",
] as const;

export type ImportSection = (typeof IMPORT_SECTION_ORDER)[number];

const SECTION_TITLES: Record<ImportSection, string> = {
	accounts: "Accounts",
	labels: "Labels",
	filters: "Rules & filters",
	addressFlags: "Senders",
	settings: "Folders & appearance",
};

export const IMPORT_VERDICTS = [
	"created",
	"updated",
	"unchanged",
	"skipped",
	"rejected",
] as const;

export type ImportVerdict = (typeof IMPORT_VERDICTS)[number];

export const verdictTone: Record<
	ImportVerdict,
	"neutral" | "positive" | "warning" | "danger" | "accent"
> = {
	created: "positive",
	updated: "accent",
	unchanged: "neutral",
	skipped: "warning",
	rejected: "danger",
};

/**
 * The wire model spells the verdict as a plain string, so a value this client
 * does not know reads as rejected rather than as an unstyled row: an item the
 * screen cannot vouch for is one the reader must look at.
 */
export const asVerdict = (value: string): ImportVerdict =>
	(IMPORT_VERDICTS as readonly string[]).includes(value)
		? (value as ImportVerdict)
		: "rejected";

/**
 * A section this client does not know is not folded into one it does. Quietly
 * filing an unrecognised item under "settings" would tell the reader something
 * false about what a newer Reader's file is doing to their configuration, which
 * is the failure the whole format exists to prevent. Unknown reads as unknown,
 * and the screen shows it under its own heading.
 */
export const UNKNOWN_SECTION = "unknown" as const;

export type ReportSectionId = ImportSection | typeof UNKNOWN_SECTION;

export const asSection = (value: string): ImportSection | undefined =>
	(IMPORT_SECTION_ORDER as readonly string[]).includes(value)
		? (value as ImportSection)
		: undefined;

export interface ReportEntry {
	id: string;
	label: string;
	verdict: ImportVerdict;
	reason?: string;
}

export interface ReportSection {
	id: ReportSectionId;
	title: string;
	entries: ReportEntry[];
}

export const groupReportSections = (
	items: readonly RemitImapConfigImportItemReport[],
): ReportSection[] => {
	const grouped = new Map<ReportSectionId, ReportEntry[]>();
	items.forEach((item, index) => {
		const section = asSection(item.section) ?? UNKNOWN_SECTION;
		const entries = grouped.get(section) ?? [];
		entries.push({
			id: `${section}-${item.key}-${index}`,
			label: item.key,
			verdict: asVerdict(item.verdict),
			reason:
				section === UNKNOWN_SECTION
					? (item.reason ??
						`This instance does not know the "${item.section}" section, so it cannot say what this entry does.`)
					: item.reason,
		});
		grouped.set(section, entries);
	});
	const ordered: ReportSectionId[] = [...IMPORT_SECTION_ORDER, UNKNOWN_SECTION];
	return ordered
		.filter((section) => grouped.has(section))
		.map((section) => ({
			id: section,
			title:
				section === UNKNOWN_SECTION
					? "Not recognised"
					: SECTION_TITLES[section],
			entries: grouped.get(section) ?? [],
		}));
};

export type VerdictCounts = Record<ImportVerdict, number>;

export const countVerdicts = (
	items: readonly RemitImapConfigImportItemReport[],
): VerdictCounts => {
	const counts: VerdictCounts = {
		created: 0,
		updated: 0,
		unchanged: 0,
		skipped: 0,
		rejected: 0,
	};
	for (const item of items) counts[asVerdict(item.verdict)] += 1;
	return counts;
};

/**
 * A blocking failure, worded for the person holding the file: what the reader
 * refused, why refusing beats importing around it, and the move that fixes it.
 * `raw` is the server's own sentence, kept verbatim so a bug report carries it.
 */
export interface FailureCopy {
	title: string;
	explanation: string;
	fix: string;
	raw: string;
}

const READ_FAILURE_COPY: Record<
	string,
	(error: ApiError) => Omit<FailureCopy, "raw">
> = {
	NotAnObject: () => ({
		title: "That is not a Reader config file",
		explanation:
			"The file was read, but it is not a configuration document — a Reader config is a JSON object carrying a kind and a schemaVersion.",
		fix: "Export one from Settings › Advanced on the instance you are moving from, or run remit config save on its host.",
	}),
	WrongKind: () => ({
		title: "That is not a Reader config file",
		explanation:
			"The file parses as JSON but does not declare itself a Reader configuration, so nothing here can be trusted to mean what it looks like.",
		fix: "Export one from Settings › Advanced on the instance you are moving from, or run remit config save on its host.",
	}),
	UnsupportedVersion: (error) => ({
		title: "This file was written by a newer Reader",
		explanation:
			error.message ||
			"The file declares a schema version this instance does not read, so importing it would drop settings it cannot understand.",
		fix: "Update this Reader, then import again. The file is unchanged and safe to keep.",
	}),
	UnknownKeys: (error) => ({
		title: "The file contains settings this version does not know",
		explanation:
			"An unknown key is refused rather than quietly dropped: losing configuration without saying so is exactly what this feature exists to prevent.",
		fix: `Update this Reader, or remove the named keys from the file and import again. ${error.message}`,
	}),
	CredentialPresent: () => ({
		title: "The file carries a credential",
		explanation:
			"A configuration document describes which credential an account needs; it never carries one. Reader refuses the file rather than importing around it — the secret may now be in your backups, your chat history, or a pull request.",
		fix: "Delete the field from the file and import again, then change that mailbox's password. Exports written by Reader never contain one.",
	}),
	Malformed: (error) => ({
		title: "The file does not match the configuration format",
		explanation:
			"Every part of the document has to validate before anything is written, and this one does not.",
		fix: `Re-export it from the instance you are moving from. ${error.message}`,
	}),
	duplicate_key: (error) => ({
		title: "The file names something twice",
		explanation:
			"A configuration names each account, label and filter once, so a document with two of the same key has no single answer to import.",
		fix: `Remove the duplicate and import again. ${error.message}`,
	}),
	unknown_label: (error) => ({
		title: "A rule points at a label that is not here",
		explanation:
			"The file applies a label neither it nor this instance carries, so the rule would land doing nothing.",
		fix: `Add the label to the file, or create it here first, then import again. ${error.message}`,
	}),
	unknown_account: (error) => ({
		title: "A rule points at an account that is not here",
		explanation:
			"The file files mail into a folder on an account it does not carry, so the rule has no destination to bind to.",
		fix: `Export the configuration again from an instance that holds both, then import that file. ${error.message}`,
	}),
};

const UNRECOGNISED_FAILURE = (error: ApiError): Omit<FailureCopy, "raw"> => ({
	title: "The file could not be imported",
	explanation:
		error.message || "The import was refused and nothing was written.",
	fix: "Re-export the configuration from the instance you are moving from and try again. If it keeps failing, report it with the line below.",
});

export const WRITE_FAILURE_CODE = "import_write_failed";

export const CONFLICT_CODE = "config_not_empty";

export interface ImportConflict {
	message: string;
	details?: Record<string, string>;
}

/**
 * The 409 a non-empty configuration answers with, or nothing.
 *
 * The endpoint's body is flat — `code`, `message`, `details` — but it does not
 * always arrive that way: `lib/client.ts` re-wraps every HTTP failure as an
 * `ApiError` so the fail-fast classifier can read a status off it, and that
 * moves the body onto `error.body`. Reading the code off the error itself finds
 * nothing there and turns the refusal into "check your connection", which is
 * how the abort-or-merge screen became unreachable. Both shapes are checked,
 * and the code is what decides: a status is confirmation where there is one,
 * never the thing being matched on.
 */
export const readConflict = (error: unknown): ImportConflict | undefined => {
	const status = getErrorStatus(error);
	if (status !== undefined && status !== 409) return undefined;
	const body: unknown = error instanceof ThrownApiError ? error.body : error;
	if (typeof body !== "object" || body === null) return undefined;
	const flat = body as {
		code?: unknown;
		message?: unknown;
		details?: unknown;
	};
	if (flat.code !== CONFLICT_CODE) return undefined;
	return {
		message: typeof flat.message === "string" ? flat.message : "",
		details:
			typeof flat.details === "object" && flat.details !== null
				? (flat.details as Record<string, string>)
				: undefined,
	};
};

/**
 * The blocking failure to render, when there is one. `import_write_failed` is
 * deliberately not one of these: the import got past validation and part of it
 * may be live, which is a different screen with a different instruction.
 */
export const readFailure = (
	report: RemitImapConfigImportReport,
): FailureCopy | undefined => {
	const error = report.errors.find((it) => it.code !== WRITE_FAILURE_CODE);
	if (!error) return undefined;
	const build = READ_FAILURE_COPY[error.code] ?? UNRECOGNISED_FAILURE;
	return { ...build(error), raw: `${error.code}: ${error.message}` };
};

export const writeFailure = (
	report: RemitImapConfigImportReport,
): ApiError | undefined =>
	report.errors.find((it) => it.code === WRITE_FAILURE_CODE);

export type SectionOutcome =
	| "landed"
	| "not-landed"
	| "failed"
	| "not-attempted"
	| "unknown";

export interface SectionResult {
	section: ImportSection;
	title: string;
	state: SectionOutcome;
	detail: string;
}

const NOT_LANDED_DETAIL = "Nothing from this section is on this instance.";

/**
 * What a stopped import left behind, section by section. The write order is
 * fixed, so the section the failure names splits the document in three: what is
 * before it ran, it did not, and what is after it was never reached.
 *
 * `applied` is the server's answer on whether any of it survived, because only
 * the backend knows whether it had a transaction: false means nothing from the
 * file is on this instance, however far the write order got. It does not say
 * why — a transaction undid the earlier writes, or the first one failed and
 * there was nothing to undo — and the report carries no flag that does, so the
 * screen states what landed and never how the store got there.
 *
 * A failure that names no section leaves the split undecidable, and every
 * section reads `unknown` rather than `landed`. Telling someone their accounts
 * are in when nothing said so is the one answer this screen must never give:
 * they would stop looking.
 */
export const sectionResults = (
	report: RemitImapConfigImportReport,
): SectionResult[] => {
	const failure = writeFailure(report);
	const named = failure?.details?.section;
	const failedSection = named ? asSection(named) : undefined;
	const nothingLanded = !report.applied;
	const counts = new Map<ImportSection, number>();
	for (const item of report.items) {
		if (asVerdict(item.verdict) === "rejected") continue;
		const section = asSection(item.section);
		if (!section) continue;
		counts.set(section, (counts.get(section) ?? 0) + 1);
	}

	const everySection = (state: SectionOutcome, detail: string) =>
		IMPORT_SECTION_ORDER.map((section) => ({
			section,
			title: SECTION_TITLES[section],
			state,
			detail,
		}));

	if (!failedSection) {
		if (nothingLanded) return everySection("not-landed", NOT_LANDED_DETAIL);
		const detail = named
			? `The import stopped in "${named}", which this instance does not recognise, so it cannot say whether this section was written.`
			: "The import stopped without naming where, so it cannot say whether this section was written. Open Settings to see what is here.";
		return everySection("unknown", detail);
	}

	const failedAt = IMPORT_SECTION_ORDER.indexOf(failedSection);

	return IMPORT_SECTION_ORDER.map((section, index) => {
		const title = SECTION_TITLES[section];
		if (section === failedSection) {
			return {
				section,
				title,
				state: "failed" as const,
				detail: failure?.message ?? "This section could not be written.",
			};
		}
		if (index > failedAt) {
			return {
				section,
				title,
				state: "not-attempted" as const,
				detail: "Not attempted — the import stopped before this section.",
			};
		}
		if (nothingLanded) {
			return {
				section,
				title,
				state: "not-landed" as const,
				detail: NOT_LANDED_DETAIL,
			};
		}
		const written = counts.get(section) ?? 0;
		return {
			section,
			title,
			state: "landed" as const,
			detail:
				written === 0
					? "Nothing in the file for this section."
					: `${written} ${written === 1 ? "entry" : "entries"} written.`,
		};
	});
};

export const FOLDER_PENDING_CODE = "folder_not_found_yet";

export interface PendingFolder {
	path: string;
	accountId?: string;
	waitingFor: string;
}

/**
 * The folders the file names that this account does not hold yet. They are
 * recorded rather than dropped: the binder writes each setting the moment IMAP
 * discovery produces its folder, so the copy has to say waiting, never lost.
 */
export const pendingFolders = (
	report: RemitImapConfigImportReport,
): PendingFolder[] => {
	const seen = new Set<string>();
	const folders: PendingFolder[] = [];
	for (const warning of report.warnings) {
		if (warning.code !== FOLDER_PENDING_CODE) continue;
		const path = warning.details?.folderPath;
		if (!path) continue;
		const filter = warning.details?.filter;
		const accountId = warning.details?.accountId;
		const key = `${accountId ?? ""}:${path}:${filter ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		folders.push({
			path,
			accountId,
			waitingFor: filter
				? `Rule “${filter}”`
				: "A folder role or a folder's own settings",
		});
	}
	return folders;
};

/* ------------------------------------------------------------------ */
/* Reading a file off disk                                            */
/* ------------------------------------------------------------------ */

/**
 * A config document is small — the largest realistic export is tens of
 * kilobytes — so anything past this is a file picked by mistake, and saying so
 * beats posting megabytes to be told the same thing.
 */
export const MAX_CONFIG_FILE_BYTES = 2 * 1024 * 1024;

export type ConfigDocument = Record<string, unknown>;

export type FileReadResult =
	| { ok: true; document: ConfigDocument }
	| { ok: false; failure: FailureCopy };

const NOT_JSON = Symbol("not json");

export const readConfigText = async (
	name: string,
	size: number,
	text: string,
): Promise<FileReadResult> => {
	if (size > MAX_CONFIG_FILE_BYTES) {
		return {
			ok: false,
			failure: {
				title: "That file is too large to be a config file",
				explanation: `${name} is ${Math.round(size / 1024)} kB. A Reader configuration is tens of kilobytes; a file this size is something else.`,
				fix: "Pick the .json file written by Settings › Advanced, or by remit config save.",
				raw: `${size} bytes > ${MAX_CONFIG_FILE_BYTES} byte limit`,
			},
		};
	}

	let syntaxError = "";
	const parsed: unknown = await safeJsonParse<unknown>(text).catch(
		(cause: unknown) => {
			syntaxError = cause instanceof Error ? cause.message : String(cause);
			return NOT_JSON;
		},
	);

	if (parsed === NOT_JSON) {
		return {
			ok: false,
			failure: {
				title: "That file is not JSON",
				explanation: `${name} could not be read as JSON at all, so there is nothing in it to import.`,
				fix: "Pick the .json file written by Settings › Advanced, or by remit config save.",
				raw: syntaxError,
			},
		};
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {
			ok: false,
			failure: {
				title: "That is not a Reader config file",
				explanation: `${name} is valid JSON but not a configuration document — a Reader config is a JSON object carrying a kind and a schemaVersion.`,
				fix: "Export one from Settings › Advanced on the instance you are moving from, or run remit config save on its host.",
				raw: `expected a JSON object, found ${Array.isArray(parsed) ? "an array" : typeof parsed}`,
			},
		};
	}

	return { ok: true, document: parsed as ConfigDocument };
};

/* ------------------------------------------------------------------ */
/* The export half                                                    */
/* ------------------------------------------------------------------ */

export const exportFileName = (now: Date): string => {
	const iso = now.toISOString().slice(0, 10);
	return `reader-config.${iso}.json`;
};

export const formatFileSize = (bytes: number): string =>
	bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;
