interface SuggestionStats {
	inboundCount: number;
	outboundCount: number;
	replyCount: number;
}

const pluralise = (value: number, singular: string, plural: string): string =>
	`${value} ${value === 1 ? singular : plural}`;

/**
 * Verbose, desktop-first stats label for a VIP suggestion row, e.g.
 * `12 received · 4 sent · 2 replies`. Settings is desktop-first; clarity
 * beats density (per the locked decision in #234). Zero-valued segments are
 * dropped so a fresh sender doesn't read as "0 received · 0 sent · 1 reply".
 */
export const formatVipSuggestionStats = (stats: SuggestionStats): string => {
	const parts: string[] = [];
	if (stats.inboundCount > 0) {
		parts.push(`${stats.inboundCount} received`);
	}
	if (stats.outboundCount > 0) {
		parts.push(`${stats.outboundCount} sent`);
	}
	if (stats.replyCount > 0) {
		parts.push(pluralise(stats.replyCount, "reply", "replies"));
	}
	return parts.join(" · ");
};
