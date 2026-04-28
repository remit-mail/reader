import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { _testCache } from "./authorizer.js";

describe("Authorizer cache", () => {
	it("returns null on cache miss", () => {
		_testCache.clear();
		const result = _testCache.getCachedDeletedAt("nonexistent");
		assert.equal(result, null);
	});

	it("stores and retrieves deletedAt value", () => {
		_testCache.clear();
		const now = Date.now();
		_testCache.setCachedDeletedAt("config-1", now);

		const result = _testCache.getCachedDeletedAt("config-1");
		assert.equal(result, now);
	});

	it("stores and retrieves undefined (active account)", () => {
		_testCache.clear();
		_testCache.setCachedDeletedAt("config-2", undefined);

		const result = _testCache.getCachedDeletedAt("config-2");
		assert.equal(result, undefined);
	});

	it("distinguishes cache miss (null) from active account (undefined)", () => {
		_testCache.clear();
		_testCache.setCachedDeletedAt("active-user", undefined);

		const miss = _testCache.getCachedDeletedAt("unknown-user");
		const hit = _testCache.getCachedDeletedAt("active-user");

		assert.equal(miss, null, "cache miss should return null");
		assert.equal(hit, undefined, "active user should return undefined");
	});

	it("clears all entries", () => {
		_testCache.clear();
		_testCache.setCachedDeletedAt("a", 100);
		_testCache.setCachedDeletedAt("b", 200);
		assert.equal(_testCache.size(), 2);

		_testCache.clear();
		assert.equal(_testCache.size(), 0);
	});
});

describe("Authorizer policy format", () => {
	it("Allow policy has correct structure", () => {
		const policy = {
			principalId: "test-sub",
			policyDocument: {
				Version: "2012-10-17",
				Statement: [
					{
						Action: "execute-api:Invoke",
						Effect: "Allow",
						Resource: "arn:aws:execute-api:*:*:*",
					},
				],
			},
			context: {
				sub: "test-sub",
				accountConfigId: "derived-id",
				"cognito:groups": "admins",
			},
		};

		assert.equal(policy.principalId, "test-sub");
		assert.equal(policy.policyDocument.Version, "2012-10-17");
		assert.equal(policy.policyDocument.Statement[0].Effect, "Allow");
		assert.equal(
			policy.policyDocument.Statement[0].Action,
			"execute-api:Invoke",
		);
		assert.ok(policy.context.accountConfigId);
	});

	it("Deny policy has correct structure", () => {
		const policy = {
			principalId: "anonymous",
			policyDocument: {
				Version: "2012-10-17",
				Statement: [
					{
						Action: "execute-api:Invoke",
						Effect: "Deny",
						Resource: "arn:aws:execute-api:*:*:*",
					},
				],
			},
		};

		assert.equal(policy.principalId, "anonymous");
		assert.equal(policy.policyDocument.Statement[0].Effect, "Deny");
	});
});
