import { FilterRuleV1Schema, repairFromDomainRule } from "@remit/data-ports";
import type { SqliteValue } from "../sqlite.js";

/**
 * A FromDomain clause holding a subdomain such as `email.gamma.nl` was compiled
 * to a registrable-domain test, which widened it to every `gamma.nl` sender and
 * filed mail the owner routes elsewhere on purpose. The compiler now keeps the
 * exact host; this applies the same decision to rules already stored, once per
 * affected row, at boot. A row still at version 0 compiles on read and needs
 * nothing here, and holds no address test to match the scan.
 */
export interface FilterFromDomainRepairClient {
	all(sql: string, params: readonly SqliteValue[]): Promise<unknown[]>;
	run(sql: string, params: readonly SqliteValue[]): Promise<number>;
}

export type FilterFromDomainRepairMode = "check" | "repair";

export type FilterFromDomainReport = {
	readonly mode: FilterFromDomainRepairMode;
	readonly widened: number;
	readonly repaired: number;
};

const CANDIDATES_SQL = `SELECT filter_id, rule FROM filter
WHERE rule LIKE '%"RegistrableDomain"%'`;

const REPAIR_SQL = "UPDATE filter SET rule = ? WHERE filter_id = ?";

type CandidateRow = { filter_id: string; rule: string };

const widenedRules = async (
	client: FilterFromDomainRepairClient,
): Promise<{ filterId: string; rule: string }[]> => {
	const rows = (await client.all(CANDIDATES_SQL, [])) as CandidateRow[];
	return rows.flatMap((row) => {
		const stored = FilterRuleV1Schema.parse(JSON.parse(row.rule));
		const rule = JSON.stringify(repairFromDomainRule(stored));
		return rule === JSON.stringify(stored)
			? []
			: [{ filterId: row.filter_id, rule }];
	});
};

export const sweepFilterFromDomain = async (
	client: FilterFromDomainRepairClient,
	mode: FilterFromDomainRepairMode,
): Promise<FilterFromDomainReport> => {
	const widened = await widenedRules(client);
	if (mode === "check") {
		return { mode, widened: widened.length, repaired: 0 };
	}
	let repaired = 0;
	for (const { filterId, rule } of widened) {
		repaired += await client.run(REPAIR_SQL, [rule, filterId]);
	}
	return { mode, widened: widened.length, repaired };
};

export const formatFilterFromDomainReport = (
	report: FilterFromDomainReport,
): string[] => {
	if (report.widened === 0) {
		return ["No filter widens a subdomain to its registrable domain"];
	}
	if (report.mode === "check") {
		return [
			`${report.widened} filter(s) widen a subdomain to its registrable domain, would be narrowed to the exact host`,
		];
	}
	return [
		`${report.repaired} of ${report.widened} filter(s) narrowed from a registrable domain to the exact subdomain host`,
	];
};
