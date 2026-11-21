import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handlers, publicHandlers } from "@remit/backend/handlers";
import { operationLedger } from "./operation-ledger.js";

describe("MCP operation ledger", () => {
	it("maps every TypeSpec operation to a tool or named exclusion", () => {
		assert.deepEqual(
			Object.keys(operationLedger).sort(),
			[...Object.keys(handlers), ...Object.keys(publicHandlers)].sort(),
		);
	});
});
