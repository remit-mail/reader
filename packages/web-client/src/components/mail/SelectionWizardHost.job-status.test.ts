import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A back-apply whose status could not be read is still running on the server
 * (#526), so the run screen's affordance looks at that job again rather than
 * queuing a second pass over the same mail.
 *
 * The host wires routing, history and several data hooks together, so — as with
 * this package's other component-level rules (see `SelectionWizardHost.run-exit.test.ts`)
 * — the wiring is read off the source. What it decides is proven where it can be
 * run: `./organize-run-state.test.ts` for the ending the screen shows, and
 * `../../hooks/useOrganizeJob.render.test.ts` for the poll it re-issues.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "SelectionWizardHost.tsx"), "utf8");

const retryBody = (): string => {
	const body = source.match(
		/const retry = \(\): void => \{([\s\S]*?)\n\t\};/,
	)?.[1];
	assert.ok(body, "the run screen has no retry");
	return body;
};

describe("retrying from an unknown status", () => {
	it("looks at the job it already has", () => {
		const body = retryBody();
		const unknown = body.indexOf('run.state === "statusUnknown"');
		assert.ok(unknown >= 0, "retry does not recognise an unknown status");
		assert.match(body.slice(unknown), /organizeJob\.refreshStatus\(\)/);
	});

	it("decides that before it can reach anything that queues a second job", () => {
		const body = retryBody();
		assert.ok(
			body.indexOf('run.state === "statusUnknown"') < body.indexOf("startJob("),
			"a second back-apply can be queued over a job that is still running",
		);
	});

	it("reads what the job is doing rather than that something failed", () => {
		assert.doesNotMatch(source, /organizeJob\.isError/);
		assert.match(source, /organizeRunState\(\{/);
	});
});
