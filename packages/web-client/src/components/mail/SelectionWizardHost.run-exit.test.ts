import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Every way off the run screen is the same movement, and none of them ends the
 * run the screen promised would keep going (#521). Ending it is a control of
 * its own, and whichever way the user leaves, the run reports where it got to.
 *
 * The host wires routing, history and several data hooks together, so — as with
 * this package's other component-level rules (see `MessageList.selection.test.ts`)
 * — the wiring is read off the source. What the exits then do is proven where it
 * can be run: `../../hooks/escalated-run-lifetime.render.test.ts` for the run's
 * lifetime, and `@remit/ui`'s `selection-wizard.render.test.ts` for the controls.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "SelectionWizardHost.tsx"), "utf8");

describe("leaving the run screen", () => {
	it("routes the header's X and back arrow through the same dismiss the footer uses", () => {
		assert.match(source, /onExit=\{current === "run" \? dismiss : cancel\}/);
	});

	it("routes hardware back through that dismiss too", () => {
		assert.match(
			source,
			/if \(action !== "BACK"\) return false;\s*\n\s*dismiss\(\);/,
		);
	});

	it("leaves the run alone on the way out", () => {
		const dismissBody = source.match(
			/const dismiss = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
		)?.[1];
		assert.ok(dismissBody, "the run screen has no dismiss");
		assert.doesNotMatch(dismissBody, /stop/i);
	});
});

describe("ending the run", () => {
	it("is a control of its own, offered only while a run is in flight", () => {
		assert.match(source, /onCancelRun: runInFlight \? stopRun : undefined/);
		assert.match(
			source,
			/const runInFlight =\s*bulkRun !== undefined && bulkRun\.outcome === undefined;/,
		);
	});

	it("stops whichever runner is paging — the list's or the wizard's own", () => {
		const stopBody = source.match(
			/const stopRun = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
		)?.[1];
		assert.ok(stopBody, "there is no way to stop a run");
		assert.match(stopBody, /escalated\.stop\(\)/);
		assert.match(stopBody, /stopBulk\(\)/);
	});
});

/**
 * Both runners report, not just the predicate one: a ticked select-all runs on
 * the wizard's own runner, and the same screen makes the same promise over it.
 */
describe("stating how a run ended once the screen is gone", () => {
	it("marks the walk-away where it happens rather than reading it back off the URL", () => {
		assert.match(source, /walkedAway\.current = true;\s*\n\s*closeWizard\(/);
	});

	for (const runner of ["runBulk", "runEscalated"]) {
		it(`reports the run ${runner} drove`, () => {
			const body =
				source.match(
					new RegExp(
						`const ${runner} = useCallback\\(([\\s\\S]*?)\\n\\t\\}, \\[`,
					),
				)?.[1] ?? "";
			assert.match(body, /if \(walkedAway\.current\)/);
			assert.match(body, /onRunEnded\?\.\(action\.kind, /);
		});
	}
});
