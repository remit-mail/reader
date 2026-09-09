import { runCheck } from "./check.js";
import { loadConfig } from "./config.js";
import { describeError, log, setLogLevel } from "./log.js";
import {
	exitCodeFor,
	NO_VERDICT_EXIT_CODE,
	renderJson,
	renderLines,
	writeVerdict,
} from "./report.js";
import { readState } from "./state.js";

/**
 * The exec seam `remit doctor` drives (D4):
 *
 *   docker compose exec -T doctor node check.mjs [--json]
 *
 * Runs a fresh check and prints it. Fresh rather than the loop's last verdict,
 * because `remit doctor` answers "is anything wrong now", and because the
 * loop's verdict is the settled one the dwell rule announces, which is
 * deliberately up to three checks behind the current state.
 *
 * It reads the loop's state file and never writes it. The auth-failure signal
 * is a delta against the totals the loop last saw, so the seam needs that
 * baseline; writing a new one would move the loop's own reference point and
 * hide the next real increase.
 */
const json = process.argv.includes("--json");

const check = async (): Promise<number> => {
	const config = loadConfig();
	setLogLevel(config.logLevel);
	const state = await readState(config.stateDir);
	const result = await runCheck(config, state.counters);
	await writeVerdict(
		process.stdout,
		json
			? renderJson(result, config.searchEmbeddingProvider)
			: renderLines(result, config.searchEmbeddingProvider),
	);
	return exitCodeFor(result);
};

process.exit(
	await check().catch((error: unknown) => {
		log.error({ error: describeError(error) }, "doctor: check could not run");
		return NO_VERDICT_EXIT_CODE;
	}),
);
