import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { handlers, publicHandlers } from "@remit/backend/handlers";

export type OperationId = keyof typeof handlers | keyof typeof publicHandlers;

const operationIds = new Set<OperationId>();

export const operationTool = (
	server: McpServer,
	declared: readonly OperationId[],
): McpServer => {
	for (const operationId of declared) operationIds.add(operationId);
	return server;
};

export const registeredOperationIds = (): OperationId[] => [...operationIds];
