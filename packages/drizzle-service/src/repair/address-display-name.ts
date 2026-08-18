import { storedDisplayName } from "@remit/data-ports/display-name";

/**
 * Rewriting the display names a spoofing sender already planted (issue #826).
 *
 * The harvest guard only decides what is stored from now on. Every name already
 * written stays live, and none of the three write paths repairs one on a
 * re-sync: `upsertAddress` refuses to overwrite a name with an empty one,
 * `upsertEnvelopeAddress` is `onConflictDoNothing`, and a ThreadMessage is
 * created once. On the instance that was hit there were 150 email-shaped
 * display names in `address` alone, 30 of them naming a different address.
 *
 * The decision is `storedDisplayName` and nothing else. Expressing it a second
 * time in SQL is what makes this dangerous: SQLite's `lower()` folds ASCII
 * where JS folds all of Unicode, and its `trim()` and a literal space in a GLOB
 * know only U+0020, so a SQL twin rewrites `Özcan@example.com` on
 * `özcan@example.com` and `foo\tbar@baz.com` on anything — names the guard
 * keeps, destroyed on a database holding the only copy. SQL narrows the scan
 * and never decides.
 *
 * This is a repair rather than a migration because a migration is SQL, and SQL
 * is exactly what must not hold the rule. It is convergent: a name the guard
 * would keep is never rewritten twice, so re-running it, or resuming it after a
 * crash part-way through, writes only what is left to write.
 */

export interface DisplayNameRepairClient {
	all(sql: string, params: readonly unknown[]): Promise<unknown[]>;
	run(sql: string, params: readonly unknown[]): Promise<number>;
}

export type DisplayNameRepairMode = "check" | "repair";

/**
 * The scan narrows to names that could carry an address at all: everything
 * `storedDisplayName` rewrites contains `x@y.zz`, so a row this misses cannot
 * be claiming anything. It is a filter, never the decision — the pairing is
 * pinned by a test that runs both halves over the same strings.
 */
export const EMBEDDED_ADDRESS_LIKE = "%_@_%.__%";

interface RepairSite {
	readonly table: string;
	readonly key: string;
	readonly name: string;
	readonly email: string;
	/** The compound the search path reads, where the table keeps one. */
	readonly compound?: string;
	/** What the write path stores for an absent name on this table. */
	readonly absent: "" | null;
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
		compound: "normalized_compound",
		absent: "",
	},
	{
		table: "envelope_address",
		key: "envelope_address_id",
		name: "display_name",
		email: "normalized_email",
		absent: "",
	},
	{
		table: "thread_message",
		key: "thread_message_id",
		name: "from_name",
		email: "from_email",
		absent: null,
	},
];

export interface SiteResult {
	readonly table: string;
	readonly scanned: number;
	readonly claiming: number;
	readonly rewritten: number;
}

export interface DisplayNameReport {
	readonly mode: DisplayNameRepairMode;
	readonly sites: readonly SiteResult[];
	readonly claiming: number;
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

/**
 * One row at a time, because each row keeps a different remainder. The set is
 * what a spoofing sender planted, not the table.
 */
const rewrite = async (
	client: DisplayNameRepairClient,
	site: RepairSite,
	row: CandidateRow,
	stored: string,
): Promise<number> => {
	const columns = [`${site.name} = ?`];
	const params: unknown[] = [stored === "" ? site.absent : stored];

	if (site.compound) {
		columns.push(`${site.compound} = ?`);
		params.push(`${stored.toLowerCase()} ${row.email ?? ""}`.trim());
	}
	params.push(row.id);

	return client.run(
		`UPDATE ${site.table} SET ${columns.join(", ")} WHERE ${site.key} = ?`,
		params,
	);
};

/**
 * `check` writes nothing, so it can be pointed at a live instance; `repair`
 * runs the same scan and rewrites what it finds. One code path, so the report
 * can never describe a decision the repair does not make.
 */
export const sweepDisplayNames = async (
	client: DisplayNameRepairClient,
	mode: DisplayNameRepairMode,
): Promise<DisplayNameReport> => {
	const sites: SiteResult[] = [];

	for (const site of SITES) {
		const rows = await candidates(client, site);
		let claiming = 0;
		let rewritten = 0;

		for (const row of rows) {
			const name = row.name ?? "";
			const stored = storedDisplayName(name, row.email ?? undefined);
			if (stored === name) continue;
			claiming += 1;
			if (mode === "repair") {
				rewritten += await rewrite(client, site, row, stored);
			}
		}

		sites.push({
			table: site.table,
			scanned: rows.length,
			claiming,
			rewritten,
		});
	}

	return {
		mode,
		sites,
		claiming: sites.reduce((sum, site) => sum + site.claiming, 0),
	};
};

export const formatDisplayNameReport = (
	report: DisplayNameReport,
): string[] => {
	if (report.claiming === 0) {
		return ["no display name claims another address"];
	}
	return report.sites
		.filter((site) => site.claiming > 0)
		.map(
			(site) =>
				`${site.table}: ${site.claiming} of ${site.scanned} scanned name(s) claim another address` +
				(report.mode === "repair" ? `, ${site.rewritten} rewritten` : ""),
		);
};
