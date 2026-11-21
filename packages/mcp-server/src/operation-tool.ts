import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { handlers, publicHandlers } from "@remit/backend/handlers";

export type OperationId = keyof typeof handlers | keyof typeof publicHandlers;

const operationTools = new Map<OperationId, Set<string>>();

export const operationTool = (
	server: McpServer,
	operationIds: readonly OperationId[],
	toolName: string,
): McpServer => {
	for (const operationId of operationIds) {
		const tools = operationTools.get(operationId) ?? new Set<string>();
		tools.add(toolName);
		operationTools.set(operationId, tools);
	}
	return server;
};

export const registeredOperationIds = (): OperationId[] => [
	...operationTools.keys(),
];
