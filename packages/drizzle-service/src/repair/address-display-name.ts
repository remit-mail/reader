import {
	EMBEDDED_ADDRESS_LIKE,
	isImpersonatingDisplayName,
} from "@remit/data-ports/display-name";

/**
 * Clearing the display names a spoofing sender already planted (issue #826).
 *
 * The harvest guard only decides what is stored from now on. Every name already
 * written stays live, and none of the three write paths repairs one on a
 * re-sync: `upsertAddress` refuses to overwrite a name with an empty one,
 * `upsertEnvelopeAddress` is `onConflictDoNothing`, and a ThreadMessage is
 * created once. On the instance that was hit there were 150 email-shaped
 * display names in `address` alone, 30 of them naming a different address.
 *
 * The decision is `isImpersonatingDisplayName` and nothing else. Expressing it
 * a second time in SQL is what makes this dangerous: SQLite's `lower()` folds
 * ASCII where JS folds all of Unicode, and its `trim()` and a literal space in
 * a GLOB know only U+0020, so a SQL twin blanks `Özcan@example.com` on
 * `özcan@example.com` and `foo\tbar@baz.com` on anything — names the guard
 * keeps, destroyed on a database holding the only copy. SQL narrows the scan
 * and never decides.
 *
 * This is a repair rather than a migration because a migration is SQL, and SQL
 * is exactly what must not hold the rule. It is convergent, so re-running it is
 * harmless: a name the guard would keep is never selected twice.
 */

export interface DisplayNameRepairClient {
	all(sql: string, params: readonly unknown[]): Promise<unknown[]>;
	run(sql: string, params: readonly unknown[]): Promise<number>;
}

export type DisplayNameRepairMode = "check" | "repair";

interface RepairSite {
	readonly table: string;
	readonly key: string;
	readonly name: string;
	readonly email: string;
	/** What the write path stores for an absent name on this table. */
	readonly blank: string;
	readonly alsoSet: string;
}

/**
 * Every column an attacker-chosen name lands in. `address.display_name` is the
 * one autocomplete reads; `envelope_address.display_name` is the From line the
 * message header renders; `thread_message.from_name` is the sender label in the
 * message list and the text the search index tokenizes.
 */
const SITES: readonly RepairSite[] = [
	{
		table: "address",
		key: "address_id",
		name: "display_name",
		email: "normalized_email",
		blank: "''",
		alsoSet: ", normalized_compound = normalized_email",
	},
	{
		table: "envelope_address",
		key: "envelope_address_id",
		name: "display_name",
		email: "normalized_email",
		blank: "''",
		alsoSet: "",
	},
	{
		table: "thread_message",
		key: "thread_message_id",
		name: "from_name",
		email: "from_email",
		blank: "NULL",
		alsoSet: "",
	},
];

const CHUNK = 500;

export interface SiteResult {
	readonly table: string;
	readonly scanned: number;
	readonly impersonating: number;
	readonly cleared: number;
}

export interface DisplayNameReport {
	readonly mode: DisplayNameRepairMode;
	readonly sites: readonly SiteResult[];
	readonly impersonating: number;
}

interface CandidateRow {
	id: string;
	name: string | null;
	email: string | null;
}

const isCandidateRow = (row: unknown): row is CandidateRow =>
	typeof row === "object" &&
	row !== null &&
	typeof (row as { id: unknown }).id === "string";

const candidates = async (
	client: DisplayNameRepairClient,
	site: RepairSite,
): Promise<CandidateRow[]> => {
	const rows = await client.all(
		`SELECT ${site.key} AS id, ${site.name} AS name, ${site.email} AS email
		 FROM ${site.table}
		 WHERE ${site.name} LIKE ?`,
		[EMBEDDED_ADDRESS_LIKE],
	);
	return rows.filter(isCandidateRow);
};

const clear = async (
	client: DisplayNameRepairClient,
	site: RepairSite,
	ids: readonly string[],
): Promise<number> => {
	let cleared = 0;
	for (let start = 0; start < ids.length; start += CHUNK) {
		const chunk = ids.slice(start, start + CHUNK);
		cleared += await client.run(
			`UPDATE ${site.table}
			 SET ${site.name} = ${site.blank}${site.alsoSet}
			 WHERE ${site.key} IN (${chunk.map(() => "?").join(", ")})`,
			chunk,
		);
	}
	return cleared;
};

/**
 * `check` reads and writes nothing, so it can be pointed at a live instance;
 * `repair` runs the same scan and clears what it finds. One code path, so the
 * report can never describe a decision the repair does not make.
 */
export const sweepDisplayNames = async (
	client: DisplayNameRepairClient,
	mode: DisplayNameRepairMode,
): Promise<DisplayNameReport> => {
	const sites: SiteResult[] = [];

	for (const site of SITES) {
		const rows = await candidates(client, site);
		const ids = rows
			.filter((row) =>
				isImpersonatingDisplayName(row.name ?? "", row.email ?? undefined),
			)
			.map((row) => row.id);
		const cleared = mode === "repair" ? await clear(client, site, ids) : 0;
		sites.push({
			table: site.table,
			scanned: rows.length,
			impersonating: ids.length,
			cleared,
		});
	}

	return {
		mode,
		sites,
		impersonating: sites.reduce((sum, site) => sum + site.impersonating, 0),
	};
};

export const formatDisplayNameReport = (
	report: DisplayNameReport,
): string[] => {
	if (report.impersonating === 0) {
		return ["no display name claims another address"];
	}
	return report.sites
		.filter((site) => site.impersonating > 0)
		.map(
			(site) =>
				`${site.table}: ${site.impersonating} of ${site.scanned} scanned name(s) claim another address` +
				(report.mode === "repair" ? `, ${site.cleared} cleared` : ""),
		);
};
