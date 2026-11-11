import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { MCP_READ_SCOPE, MCP_RULES_SCOPE } from "./auth/scopes.js";
import type { McpDeps } from "./deps.js";
import { registerFilterTools } from "./filter-tools.js";
import { registerFolderTools } from "./folder-tools.js";
import { registerReadTools } from "./read-tools.js";

export interface McpPrincipal {
	userId: string;
	scopes: readonly string[];
}

export type McpRequestHandler = (request: Request) => Promise<Response>;

const unusedJsonSchemaValidator: jsonSchemaValidator = {
	getValidator: () => {
		throw new Error(
			"JSON Schema validation is unused by this server: tools validate input with zod and declare no output schema",
		);
	},
};

const buildServer = (principal: McpPrincipal, deps: McpDeps): McpServer => {
	const server = new McpServer(
		{ name: "remit-reader", version: "1.0.0" },
		{ jsonSchemaValidator: unusedJsonSchemaValidator },
	);
	if (principal.scopes.includes(MCP_READ_SCOPE)) {
		registerReadTools(server, deps, deriveAccountConfigId(principal.userId));
	}
	if (principal.scopes.includes(MCP_RULES_SCOPE)) {
		registerFolderTools(server, deps, deriveAccountConfigId(principal.userId));
		registerFilterTools(server, deps, principal.userId);
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
