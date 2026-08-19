import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A run states how it ended, to whoever is still there to read it (#521). The
 * run screen invites the user to close it and keep the run going, which leaves
 * the run with no screen of its own — so the list says what it reached, whether
 * that was everything or a hundred out of three thousand.
 *
 * The list wires the virtualizer, routing and several data hooks together, so
 * — as with this package's other component-level rules (see
 * `MessageList.selection.test.ts`) — the wiring is read off the source. The
 * sentences themselves are unit-tested in `../../lib/bulk-action-copy.test.ts`,
 * and which runs reach this seam in `SelectionWizardHost.run-exit.test.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "MessageList.tsx"), "utf8");

const reportBody = source.match(
	/const reportRunOutcome = useCallback\(([\s\S]*?)\n\t\t\[pushError\],/,
)?.[1];

describe("reporting how a run ended", () => {
	it("hands the wizard somewhere to report an ending it can no longer show", () => {
		assert.ok(reportBody, "the list reports no run outcome");
		const host = source.match(/<SelectionWizardHost[\s\S]*?\/>/)?.[0] ?? "";
		assert.match(host, /onRunEnded=\{reportRunOutcome\}/);
	});

	it("names both endings: what it covered, and what it stopped short of", () => {
		assert.match(reportBody ?? "", /bulkActionStoppedTitle\(outcome\.done\)/);
		assert.match(
			reportBody ?? "",
			/bulkActionCompletionText\(kind, outcome\.done, deleteOutcome\)/,
		);
	});

	it("raises a stopped run as a warning rather than a passing note", () => {
		assert.match(reportBody ?? "", /severity: "warning"/);
	});
});

describe("the run the wizard leaves behind", () => {
	it("is stoppable from the wizard, which is not the same as closing it", () => {
		assert.match(source, /stop: escalation\.stop,/);
	});

	it("keeps reporting on the bar from the moment it starts", () => {
		assert.match(
			source,
			/escalation\.progress\?\.total \?\? selectionCount/,
			"a run with no batch finished yet has no denominator to show",
		);
	});
});
