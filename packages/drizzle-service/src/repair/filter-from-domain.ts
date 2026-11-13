import { FilterRuleV1Schema, narrowFromDomainRule } from "@remit/data-ports";
import type { SqliteRepairClient } from "./client.js";

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
	client: SqliteRepairClient,
): Promise<{ filterId: string; rule: string }[]> => {
	const rows = (await client.all(CANDIDATES_SQL, [])) as CandidateRow[];
	return rows.flatMap((row) => {
		const stored = FilterRuleV1Schema.parse(JSON.parse(row.rule));
		const rule = JSON.stringify(narrowFromDomainRule(stored));
		return rule === JSON.stringify(stored)
			? []
			: [{ filterId: row.filter_id, rule }];
	});
};

export const repairFilterFromDomain = async (
	client: SqliteRepairClient,
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
