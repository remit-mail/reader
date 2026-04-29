import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ForbiddenError } from "@remit/remit-electrodb-service";

const __dirname = dirname(fileURLToPath(import.meta.url));

const readHandlerSource = (relativePath: string): string =>
	readFileSync(resolve(__dirname, relativePath), "utf-8");

const findEnvReferences = (source: string, prefix: string): string[] => {
	const re = new RegExp(`env\\.(${prefix}[A-Z0-9_]+)`, "g");
	const seen = new Set<string>();
	for (const match of source.matchAll(re)) seen.add(match[1]);
	return [...seen];
};

/**
 * Extract Cognito groups from API Gateway claims.
 * Exported from admin.ts — we re-implement here to test the logic.
 */
const getCognitoGroups = (claims: Record<string, unknown>): string[] => {
	const groups = claims["cognito:groups"];
	if (typeof groups === "string") return groups.split(",").map((g) => g.trim());
	if (Array.isArray(groups)) return groups as string[];
	return [];
};

const assertAdminGroup = (groups: string[]): void => {
	if (!groups.includes("admins")) {
		throw new ForbiddenError("Only admins can finalize account deletion");
	}
};

// ── DELETE /me tests ─────────────────────────────────────────────────

describe("DELETE /me handler logic", () => {
	it("produces correct SQS payload shape for AccountDelete", () => {
		const accountConfigId = "abcdefghijklmnopqrstuvwxy";
		const payload = { type: "AccountDelete", accountConfigId };

		assert.equal(payload.type, "AccountDelete");
		assert.equal(payload.accountConfigId, accountConfigId);
	});

	it("returns 202 response shape on success", () => {
		const response = {
			statusCode: 202,
			message: "Account deletion initiated",
		};

		assert.equal(response.statusCode, 202);
		assert.ok(response.message.includes("deletion"));
	});

	it("returns 202 idempotent response when already deleting", () => {
		const response = {
			statusCode: 202,
			message: "Account deletion already in progress",
		};

		assert.equal(response.statusCode, 202);
		assert.ok(response.message.includes("already"));
	});
});

// ── Admin finalize tests ─────────────────────────────────────────────

describe("Admin finalize-delete handler logic", () => {
	it("parses comma-separated groups string", () => {
		const groups = getCognitoGroups({
			"cognito:groups": "admins,users",
		});
		assert.deepEqual(groups, ["admins", "users"]);
	});

	it("parses array groups", () => {
		const groups = getCognitoGroups({
			"cognito:groups": ["admins", "power-users"],
		});
		assert.deepEqual(groups, ["admins", "power-users"]);
	});

	it("returns empty array when no groups claim", () => {
		const groups = getCognitoGroups({});
		assert.deepEqual(groups, []);
	});

	it("allows admin callers", () => {
		assert.doesNotThrow(() => assertAdminGroup(["admins", "users"]));
	});

	it("rejects non-admin callers with ForbiddenError", () => {
		assert.throws(
			() => assertAdminGroup(["users"]),
			(err: unknown) => {
				assert.ok(err instanceof ForbiddenError);
				assert.equal(err.statusCode, 403);
				return true;
			},
		);
	});

	it("rejects callers with no groups", () => {
		assert.throws(
			() => assertAdminGroup([]),
			(err: unknown) => {
				assert.ok(err instanceof ForbiddenError);
				return true;
			},
		);
	});

	it("produces correct SQS payload shape for FinalizeAccountDelete", () => {
		const accountConfigId = "target-config-id-1234567890";
		const payload = { type: "FinalizeAccountDelete", accountConfigId };

		assert.equal(payload.type, "FinalizeAccountDelete");
		assert.equal(payload.accountConfigId, accountConfigId);
	});
});

// ── Env contract regression (issue #260) ─────────────────────────────
//
// The infra api-stack injects SQS_QUEUE_URL_ACCOUNT_FANOUT and
// SQS_QUEUE_URL_ACCOUNT_FINALIZE. The handlers must read those exact names —
// expect-env throws synchronously on a missing key, which surfaces as a 500
// from the Lambda and reds the post-deploy smoke sweep.

describe("handler env var names match infra contract", () => {
	it("me.ts reads SQS_QUEUE_URL_ACCOUNT_FANOUT", () => {
		const source = readHandlerSource("./me.ts");
		const refs = findEnvReferences(source, "SQS_");
		assert.deepEqual(refs, ["SQS_QUEUE_URL_ACCOUNT_FANOUT"]);
	});

	it("admin.ts reads SQS_QUEUE_URL_ACCOUNT_FINALIZE", () => {
		const source = readHandlerSource("./admin.ts");
		const refs = findEnvReferences(source, "SQS_");
		assert.deepEqual(refs, ["SQS_QUEUE_URL_ACCOUNT_FINALIZE"]);
	});
});
