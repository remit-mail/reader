/**
 * Which part of the document an item came from. The wire model spells these as
 * a plain string, so the closed set lives here rather than in the API contract.
 */
export const ConfigImportSection = {
	Accounts: "accounts",
	Labels: "labels",
	Filters: "filters",
	AddressFlags: "addressFlags",
	Settings: "settings",
} as const;

export type ConfigImportSectionValue =
	(typeof ConfigImportSection)[keyof typeof ConfigImportSection];

export const ConfigImportVerdict = {
	Created: "created",
	Updated: "updated",
	Unchanged: "unchanged",
	Skipped: "skipped",
	Rejected: "rejected",
} as const;

export type ConfigImportVerdictValue =
	(typeof ConfigImportVerdict)[keyof typeof ConfigImportVerdict];

export interface ConfigImportItemReport {
	section: ConfigImportSectionValue;
	key: string;
	verdict: ConfigImportVerdictValue;
	reason?: string;
}

/** The flat error shape the API emits: a code a client branches on, and text. */
export interface ConfigImportProblem {
	code: string;
	message: string;
	details?: Record<string, string>;
}

export interface ConfigImportReport {
	importId?: string;
	valid: boolean;
	schemaVersion: number;
	applied: boolean;
	items: ConfigImportItemReport[];
	errors: ConfigImportProblem[];
	warnings: ConfigImportProblem[];
	accountsNeedingCredentials: string[];
}

/**
 * The refusal a non-empty configuration answers with under `onExisting: abort`.
 * Separate from the report because it is a different status code, not a
 * different verdict: nothing about the document was wrong.
 */
export interface ConfigImportConflict {
	code: "config_not_empty";
	message: string;
	details: Record<string, string>;
}

/**
 * A rejected document is an answer, not a fault, so the import returns which
 * of the two it produced rather than throwing one of them.
 */
export type ConfigImportOutcome =
	| { outcome: "report"; report: ConfigImportReport }
	| { outcome: "conflict"; conflict: ConfigImportConflict };
