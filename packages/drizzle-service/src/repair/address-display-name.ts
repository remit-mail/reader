import { storedDisplayName } from "@remit/data-ports/display-name";

export interface DisplayNameRepairClient {
	all(sql: string, params: readonly unknown[]): Promise<unknown[]>;
	run(sql: string, params: readonly unknown[]): Promise<number>;
}

export type DisplayNameRepairMode = "check" | "repair";

export const EMBEDDED_ADDRESS_LIKE = "%_@_%.__%";

interface RepairSite {
	readonly table: string;
	readonly keyColumn: string;
	readonly nameColumn: string;
	readonly emailColumn: string;
	readonly searchCompoundColumn?: string;
	readonly storedWhenNameIsAbsent: "" | null;
}

const SITES: readonly RepairSite[] = [
	{
		table: "address",
		keyColumn: "address_id",
		nameColumn: "display_name",
		emailColumn: "normalized_email",
		searchCompoundColumn: "normalized_compound",
		storedWhenNameIsAbsent: "",
	},
	{
		table: "envelope_address",
		keyColumn: "envelope_address_id",
		nameColumn: "display_name",
		emailColumn: "normalized_email",
		storedWhenNameIsAbsent: "",
	},
	{
		table: "thread_message",
		keyColumn: "thread_message_id",
		nameColumn: "from_name",
		emailColumn: "from_email",
		storedWhenNameIsAbsent: null,
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
		`SELECT ${site.keyColumn} AS id, ${site.nameColumn} AS name, ${site.emailColumn} AS email
		 FROM ${site.table}
		 WHERE ${site.nameColumn} LIKE ?`,
		[EMBEDDED_ADDRESS_LIKE],
	);
	return rows.filter(isCandidateRow);
};

const rewrite = async (
	client: DisplayNameRepairClient,
	site: RepairSite,
	row: CandidateRow,
	stored: string,
): Promise<number> => {
	const columns = [`${site.nameColumn} = ?`];
	const params: unknown[] = [
		stored === "" ? site.storedWhenNameIsAbsent : stored,
	];

	if (site.searchCompoundColumn) {
		columns.push(`${site.searchCompoundColumn} = ?`);
		params.push(`${stored.toLowerCase()} ${row.email ?? ""}`.trim());
	}
	params.push(row.id);

	return client.run(
		`UPDATE ${site.table} SET ${columns.join(", ")} WHERE ${site.keyColumn} = ?`,
		params,
	);
};

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
