import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	registerAccountReadTools,
	registerAccountTools,
} from "./account-tools.js";
import {
	MCP_ACCOUNT_SCOPE,
	MCP_CALENDAR_SCOPE,
	MCP_READ_SCOPE,
	MCP_RULES_SCOPE,
	MCP_SEND_SCOPE,
} from "./auth/scopes.js";
import { registerCalendarTools } from "./calendar-tools.js";
import { registerDeleteTools } from "./delete-tools.js";
import type { McpDeps } from "./deps.js";
import { registerFilterTools } from "./filter-tools.js";
import { registerFolderTools } from "./folder-tools.js";
import {
	registerLabelReadTools,
	registerLabelWriteTools,
} from "./label-tools.js";
import {
	registerMailActionReadTools,
	registerMailActionWriteTools,
} from "./mail-action-tools.js";
import { MCP_ATTACHMENT_MAX_BYTES, registerMailTools } from "./mail-tools.js";
import { registerMoveTools } from "./move-tools.js";
import { registerReadTools } from "./read-tools.js";
import { registerRescanTools } from "./rescan-tools.js";

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

const MCP_REQUEST_MAX_BYTES =
	Math.ceil(MCP_ATTACHMENT_MAX_BYTES / 3) * 4 + 64 * 1024;

const boundedRequest = async (request: Request): Promise<Request | null> => {
	if (!request.body) return request;
	const declared = Number(request.headers.get("content-length"));
	if (declared > MCP_REQUEST_MAX_BYTES) return null;

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MCP_REQUEST_MAX_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}

	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new Request(request, { body });
};

const buildServer = (principal: McpPrincipal, deps: McpDeps): McpServer => {
	const server = new McpServer(
		{ name: "remit-reader", version: "1.0.0" },
		{ jsonSchemaValidator: unusedJsonSchemaValidator },
	);
	if (principal.scopes.includes(MCP_READ_SCOPE)) {
		registerReadTools(server, deps, deriveAccountConfigId(principal.userId));
		registerAccountReadTools(
			server,
			deps,
			deriveAccountConfigId(principal.userId),
		);
		registerLabelReadTools(
			server,
			deps,
			deriveAccountConfigId(principal.userId),
		);
		registerMailActionReadTools(
			server,
			deps,
			deriveAccountConfigId(principal.userId),
		);
	}
	if (principal.scopes.includes(MCP_RULES_SCOPE)) {
		registerFolderTools(server, deps, deriveAccountConfigId(principal.userId));
		registerLabelWriteTools(
			server,
			deps,
			deriveAccountConfigId(principal.userId),
		);
		registerFilterTools(server, deps, principal.userId);
		registerMoveTools(server, deps, principal.userId);
		registerRescanTools(server, deps, deriveAccountConfigId(principal.userId));
		registerDeleteTools(server, deps, deriveAccountConfigId(principal.userId));
		registerMailActionWriteTools(
			server,
			deps,
			deriveAccountConfigId(principal.userId),
			principal.userId,
		);
	}
	if (principal.scopes.includes(MCP_ACCOUNT_SCOPE)) {
		registerAccountTools(server, deps, principal.userId);
	}
	if (principal.scopes.includes(MCP_CALENDAR_SCOPE)) {
		registerCalendarTools(server, deps.calendarClient(principal.userId));
	}
	if (principal.scopes.includes(MCP_SEND_SCOPE)) {
		registerMailTools(server, deps, deriveAccountConfigId(principal.userId));
	}
	return server;
};

export const createMcpHandler =
	(principal: McpPrincipal, deps: McpDeps): McpRequestHandler =>
	async (request) => {
		const bounded = await boundedRequest(request);
		if (!bounded) return new Response(null, { status: 413 });
		const server = buildServer(principal, deps);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await server.connect(transport);
		return transport.handleRequest(bounded).finally(() => server.close());
	};
