import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTarget } from "./target.ts";

describe("resolveTarget", () => {
	it("takes the API root as given and derives the Access app from its origin", () => {
		assert.deepEqual(resolveTarget("https://app.remit.email/api"), {
			ok: true,
			target: {
				apiUrl: "https://app.remit.email/api",
				appUrl: "https://app.remit.email",
			},
		});
	});

	it("drops a trailing slash so paths join without doubling it", () => {
		const result = resolveTarget("https://app.remit.email/api/");
		assert.equal(
			result.ok && result.target.apiUrl,
			"https://app.remit.email/api",
		);
	});

	it("reads a bare origin as that origin's /api", () => {
		const result = resolveTarget("https://app.remit.email");
		assert.equal(
			result.ok && result.target.apiUrl,
			"https://app.remit.email/api",
		);
	});

	it("refuses an unset or blank target, naming the variable", () => {
		for (const raw of [undefined, "", "  "]) {
			const result = resolveTarget(raw);
			assert.equal(result.ok, false);
			assert.match(!result.ok ? result.message : "", /REMIT_API_URL/);
		}
	});

	it("refuses something that is not an http URL", () => {
		for (const raw of ["app.remit.email", "ftp://app.remit.email/api"]) {
			const result = resolveTarget(raw);
			assert.equal(result.ok, false, raw);
		}
	});
});
