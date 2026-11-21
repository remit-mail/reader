import assert from "node:assert/strict";
import { describe, it } from "node:test";
import spec from "@remit/api-openapi-spec/openapi.json" with { type: "json" };
import { operationLedger } from "./operation-ledger.js";

describe("MCP operation ledger", () => {
	it("maps every TypeSpec operation to a tool or named exclusion", () => {
		const operationIds = Object.values(spec.paths)
			.flatMap((path) => Object.values(path))
			.flatMap((operation) =>
				"operationId" in operation ? [operation.operationId] : [],
			)
			.sort();
		assert.deepEqual(Object.keys(operationLedger).sort(), operationIds);
	});
});
