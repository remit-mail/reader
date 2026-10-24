import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { McpDeps } from "./deps.js";
import { MCP_RULES_SCOPE, registerFolderTools } from "./folder-tools.js";
import { registerReadTools } from "./read-tools.js";

export const MCP_READ_SCOPE = "mail:read";

export interface McpPrincipal {
	userId: string;
	scopes: readonly string[];
}

export type McpRequestHandler = (request: Request) => Promise<Response>;

const buildServer = (principal: McpPrincipal, deps: McpDeps): McpServer => {
	const server = new McpServer({ name: "remit-reader", version: "1.0.0" });
	if (principal.scopes.includes(MCP_READ_SCOPE)) {
		registerReadTools(server, deps, deriveAccountConfigId(principal.userId));
	}
	if (principal.scopes.includes(MCP_RULES_SCOPE)) {
		registerFolderTools(server, deps, deriveAccountConfigId(principal.userId));
	}
	return server;
};

export const createMcpHandler =
	(principal: McpPrincipal, deps: McpDeps): McpRequestHandler =>
	async (request) => {
		const server = buildServer(principal, deps);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await server.connect(transport);
		return transport.handleRequest(request).finally(() => server.close());
	};
