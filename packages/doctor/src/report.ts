import type { CheckResult } from "./verdict.js";

/**
 * The exec seam (D4). `remit doctor` is a POSIX shell script whose only tool is
 * `docker`, so it does not scrape anything itself — it runs
 * `docker compose exec -T doctor node check.mjs` and formats what comes back.
 *
 * Two renderings, because the wrapper needs both and can build neither from the
 * other: a line format `while read -r key rest` parses in shell without a JSON
 * parser, and a JSON object for `remit doctor --json` to pass straight through.
 *
 * The line format is a contract. Keys are a closed vocabulary, one record per
 * line, the key is the first space-delimited token and the value is the rest of
 * the line verbatim. New keys may be added; existing keys do not change meaning.
 *
 *   verdict     healthy | degraded
 *   checked-at  ISO 8601 UTC
 *   summary     one-line headline, no reason detail
 *   reason      <code> <summary>   — zero or more, stable order
 *   detail      <code> <detail>    — zero or more, only for reasons that have one
 *
 * `reason` summaries carry counts, service names and queue names (D10).
 * `detail` carries the account ids behind them and is printed here because this
 * output never leaves the box; nothing in the alert path reads it.
 */
export const renderLines = (result: CheckResult): string => {
	const lines = [
		`verdict ${result.verdict}`,
		`checked-at ${result.checkedAt}`,
		`summary ${result.summary}`,
	];
	for (const reason of result.reasons) {
		lines.push(`reason ${reason.code} ${reason.summary}`);
	}
	for (const reason of result.reasons) {
		if (reason.detail !== undefined) {
			lines.push(`detail ${reason.code} ${reason.detail}`);
		}
	}
	return `${lines.join("\n")}\n`;
};

export const renderJson = (result: CheckResult): string =>
	`${JSON.stringify(
		{
			verdict: result.verdict,
			checkedAt: result.checkedAt,
			summary: result.summary,
			reasons: result.reasons.map((reason) => ({
				code: reason.code,
				summary: reason.summary,
				detail: reason.detail ?? null,
			})),
		},
		null,
		2,
	)}\n`;

/**
 * 0 healthy, 1 degraded. A crash before a verdict exists exits 2 — both are
 * non-zero, so a cron job or an external monitor can use the command directly,
 * and a caller that wants to distinguish "something is wrong with the stack"
 * from "the checker could not answer" can.
 */
export const exitCodeFor = (result: CheckResult): number =>
	result.verdict === "healthy" ? 0 : 1;

export const NO_VERDICT_EXIT_CODE = 2;
