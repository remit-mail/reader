import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Selection mode has one source of truth and one exit (#115). `MessageList`
 * wires the DOM, the virtualizer, routing and several data hooks together, so
 * — as with this package's other component-level rules (see
 * `../../index.css.test.ts`) — the rule is enforced by reading the source
 * rather than rendering the tree. The decisions themselves are unit-tested in
 * `../../lib/selection-mode.test.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "MessageList.tsx"), "utf8");

describe("MessageList selection mode", () => {
	it("keeps no selection-mode flag of its own", () => {
		assert.doesNotMatch(source, /useState[^\n]*[iI]sMultiSelectMode/);
		assert.doesNotMatch(source, /setIsMultiSelectMode/);
	});

	it("derives the mode from the selection count", () => {
		assert.match(
			source,
			/const isMultiSelectMode = deriveIsMultiSelectMode\(\s*selectedCount,/,
		);
	});

	it("calls the selection hook's clearSelection from exactly one place", () => {
		const calls = source.match(/\bclearSelection\(\)/g) ?? [];
		assert.equal(calls.length, 1);
		assert.match(
			source,
			/const exitSelection = useCallback\(\(\) => \{[^}]*clearSelection\(\);/,
		);
	});

	it("exits selection when the mailbox changes", () => {
		assert.match(source, /previousMailboxIdRef\.current === mailboxId/);
	});

	it("turns the back gesture into an exit, and only while selecting", () => {
		assert.match(
			source,
			/shouldExitSelectionOnNavigate\(action, hasSelection\)/,
		);
		assert.match(source, /disabled: !hasSelection/);
	});
});
