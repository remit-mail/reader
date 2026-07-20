import { formatNumber } from "./format";

/** The subset of the search predicate that names the scope in escalation copy. */
export interface EscalationScopeQuery {
	query?: string;
	from?: string;
}

/**
 * Names what an escalated selection covers, for the notice text and the
 * confirm dialog — never a bare "Select all" (issue #92 requirement 4). Free
 * text wins when present since it's what the user actually typed; `from:`
 * alone still names a scope. Neither present is unreachable in practice (the
 * escalation control only ever renders for an active search), but the
 * fallback keeps the label honest instead of throwing.
 */
export const describeSearchScope = (query: EscalationScopeQuery): string => {
	if (query.query) return `matching "${query.query}"`;
	if (query.from) return `from "${query.from}"`;
	return "matching your search";
};

/** "Select all matching "npm"" — the escalation notice's action label. */
export const escalationActionLabel = (query: EscalationScopeQuery): string =>
	`Select all ${describeSearchScope(query)}`;

/** "All 3,412 matching "npm" selected" — the bar's status label once escalated. */
export const escalatedStatusLabel = (
	query: EscalationScopeQuery,
	total: number,
): string =>
	`All ${formatNumber(total)} ${describeSearchScope(query)} selected`;
