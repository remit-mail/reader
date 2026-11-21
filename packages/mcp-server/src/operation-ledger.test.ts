import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handlers, publicHandlers } from "@remit/backend/handlers";
import {
	MCP_ACCOUNT_SCOPE,
	MCP_READ_SCOPE,
	MCP_RULES_SCOPE,
} from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { excludedOperations } from "./operation-ledger.js";
import { registeredOperationIds } from "./operation-tool.js";
import { createMcpHandler } from "./server.js";

describe("MCP operation ledger", () => {
	it("maps every TypeSpec operation to a real tool or named exclusion", async () => {
		const handler = createMcpHandler(
			{
				userId: "ledger",
				scopes: [MCP_READ_SCOPE, MCP_RULES_SCOPE, MCP_ACCOUNT_SCOPE],
			},
			{
				filters: { organizeQueue: {}, logger: {} },
				moves: { budgetMs: 1, pollIntervalMs: 1 },
			} as McpDeps,
		);
		await handler(
			new Request("https://mcp.example/mcp", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
				}),
			}),
		);

		const operationIds = [
			...Object.keys(handlers),
			...Object.keys(publicHandlers),
		].sort();
		const mapped = [
			...registeredOperationIds(),
			...Object.keys(excludedOperations),
		].sort();
		assert.deepEqual(mapped, operationIds);
	});
});
