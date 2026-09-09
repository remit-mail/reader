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
 *   semantic    the deployment's SEARCH_EMBEDDING_PROVIDER, verbatim
 *
 * `reason` summaries carry counts, service names and queue names (D10).
 * `detail` carries the account ids behind them and is printed here because this
 * output never leaves the box; nothing in the alert path reads it.
 */

/**
 * One record is one line, whatever the value contains.
 *
 * A queue name may hold a newline — the exposition format escapes it, and the
 * parser decodes it back into a real one — and a caught error's message may
 * hold anything. Either would split a record in two, and a caller parsing by
 * position reads the remainder as a record with a garbage key: half a reason
 * silently dropped, with nothing to say it happened. The JSON rendering and the
 * webhook body escape their way out of this; a line format cannot, so the
 * control characters are collapsed before they get in.
 */
const DELETE = 0x7f;
const LAST_CONTROL = 0x1f;

const isControl = (code: number): boolean =>
	code <= LAST_CONTROL || code === DELETE;

// Written as a code-point scan rather than a character class: a regular
// expression carrying literal control characters is exactly the pattern the
// lint rule exists to catch, and spelling the range out reads better anyway.
const oneLine = (value: string): string => {
	let out = "";
	let pending = false;
	for (const character of value) {
		if (isControl(character.charCodeAt(0))) {
			pending = out !== "";
			continue;
		}
		if (pending) {
			out += " ";
			pending = false;
		}
		out += character;
	}
	return out;
};

export const renderLines = (
	result: CheckResult,
	searchEmbeddingProvider: string,
): string => {
	const lines = [
		`verdict ${result.verdict}`,
		`checked-at ${result.checkedAt}`,
		`summary ${oneLine(result.summary)}`,
		`semantic ${oneLine(searchEmbeddingProvider)}`,
	];
	for (const reason of result.reasons) {
		lines.push(`reason ${reason.code} ${oneLine(reason.summary)}`);
	}
	for (const reason of result.reasons) {
		if (reason.detail !== undefined) {
			lines.push(`detail ${reason.code} ${oneLine(reason.detail)}`);
		}
	}
	return `${lines.join("\n")}\n`;
};

export const renderJson = (
	result: CheckResult,
	searchEmbeddingProvider: string,
): string =>
	`${JSON.stringify(
		{
			verdict: result.verdict,
			checkedAt: result.checkedAt,
			summary: result.summary,
			semantic: searchEmbeddingProvider,
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

/**
 * The verdict has to have left the process before it exits.
 *
 * `process.exit` does not flush a pending write, and stdout is a pipe under
 * `compose exec -T`, so a write the kernel could not take in one go is
 * discarded — silently, and only for the verdicts long enough to fill the
 * buffer, which are the degraded ones carrying several reasons. The reader
 * then sees a document that stops mid-token with an exit code saying it is
 * complete. Waiting for the drain and keeping the explicit exit is what closes
 * that without letting a lingering socket hold the process open instead.
 */
export const writeVerdict = (
	stream: NodeJS.WritableStream,
	text: string,
): Promise<void> =>
	new Promise((resolve) => {
		if (stream.write(text)) {
			resolve();
			return;
		}
		stream.once("drain", () => resolve());
	});
