import type { McpPermission } from "@remit/ui/mcp-pages";

export const MCP_READ_SCOPE = "mail:read";
export const MCP_RULES_SCOPE = "mail:rules";
export const OFFLINE_ACCESS_SCOPE = "offline_access";

export const MCP_SCOPES = [MCP_READ_SCOPE, MCP_RULES_SCOPE] as const;

const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
	[MCP_READ_SCOPE]: "Read your mail",
	[MCP_RULES_SCOPE]: "Create and change folders and filters",
	[OFFLINE_ACCESS_SCOPE]: "Stay connected until you disconnect it",
};

export const describeScopes = (scopes: readonly string[]): McpPermission[] =>
	scopes.map((scope) => ({
		scope,
		description: SCOPE_DESCRIPTIONS[scope] ?? `Use the "${scope}" permission`,
	}));
