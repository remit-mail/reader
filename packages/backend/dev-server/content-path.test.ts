import assert from "node:assert/strict";
import { sep } from "node:path";
import { describe, it } from "node:test";
import { resolveContentPath } from "./content-path.js";

describe("resolveContentPath — dev-server /content/* path safety (#310 review P1)", () => {
	const ROOT = "/x/storage";

	it("returns the absolute path for a normal nested storage key", () => {
		assert.equal(
			resolveContentPath(ROOT, "accounts/cfg/acc/messages/m/parts/1"),
			"/x/storage/accounts/cfg/acc/messages/m/parts/1",
		);
	});

	it("rejects a sibling-prefix escape (`startsWith` was the original bug)", () => {
		// `/x/storage-evil/y` shares the prefix `/x/storage` with the root,
		// so the naive `fullPath.startsWith(ROOT)` check would pass it.
		assert.equal(resolveContentPath(ROOT, `..${sep}storage-evil${sep}y`), null);
	});

	it("rejects parent-directory traversal via `..`", () => {
		assert.equal(resolveContentPath(ROOT, `..${sep}etc${sep}passwd`), null);
		assert.equal(
			resolveContentPath(ROOT, `accounts${sep}..${sep}..${sep}etc`),
			null,
		);
	});

	it("rejects an absolute key that resolves outside the root", () => {
		assert.equal(resolveContentPath(ROOT, "/etc/passwd"), null);
	});

	it("rejects an empty key (would expose the root listing)", () => {
		assert.equal(resolveContentPath(ROOT, ""), null);
	});
});
