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
				client: {
					organizeJobRequest: {},
					queues: { accountFanout: {} },
				} as never,
				apiConfig: undefined as never,
				logger: undefined as never,
				folders: {
					settleTimeoutMs: 1,
					pollIntervalMs: 1,
					sleep: async () => {},
				},
				moves: {
					budgetMs: 1,
					pollIntervalMs: 1,
					sleep: async () => {},
					now: Date.now,
				},
			} satisfies McpDeps,
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
