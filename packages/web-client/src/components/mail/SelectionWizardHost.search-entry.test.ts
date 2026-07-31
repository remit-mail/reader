import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A filter made from a search belongs to the account the search ran over (#524).
 * The surface hands its account to the host on the props; a search entry that
 * reads past it writes the rule against whichever account happens to be first in
 * the list, and the mail the user was looking at is never filtered.
 *
 * Which account wins is decided — and tested — in
 * `../../lib/organize/search-to-rule.test.ts`. What is read off the source here
 * is that the host asks that question with the surface's account in hand, which
 * is the wiring the bug lived in and which no unit of the resolver can prove.
 * The host wires routing, history and several data hooks together, so it is read
 * rather than rendered, as this package's other component-level rules are (see
 * `SelectionWizardHost.run-exit.test.ts`).
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "SelectionWizardHost.tsx"), "utf8");

const host = source.match(
	/export function SelectionWizardHost\(([\s\S]*)$/,
)?.[1];

describe("the search entry's account", () => {
	it("is resolved with the account the surface handed over", () => {
		assert.ok(host, "the host is gone");
		const call = host.match(/searchRuleAccountId\(([\s\S]*?)\)/)?.[1];
		assert.ok(call, "the search entry resolves no account of its own");
		assert.match(call, /\bprops\.accountId\b/);
	});

	it("never reaches past it for the first configured account", () => {
		assert.ok(host, "the host is gone");
		assert.doesNotMatch(host, /accounts\[0\]/);
	});
});
