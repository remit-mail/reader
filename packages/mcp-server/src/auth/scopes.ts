import type { McpPermission } from "@remit/ui/mcp-pages";

export const MCP_READ_SCOPE = "mail:read";
export const MCP_RULES_SCOPE = "mail:rules";
export const MCP_SEND_SCOPE = "mail:send";
export const MCP_ACCOUNT_SCOPE = "account";
export const MCP_CALENDAR_SCOPE = "calendar";
export const MCP_OPERATOR_SCOPE = "operator";
export const OFFLINE_ACCESS_SCOPE = "offline_access";

export const MCP_SCOPES = [
	MCP_READ_SCOPE,
	MCP_RULES_SCOPE,
	MCP_SEND_SCOPE,
	MCP_ACCOUNT_SCOPE,
	MCP_CALENDAR_SCOPE,
] as const;

const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
	[MCP_READ_SCOPE]: "Read your mail",
	[MCP_RULES_SCOPE]: "Create and change folders and filters, and move mail",
	[MCP_SEND_SCOPE]: "Compose and send mail",
	[MCP_ACCOUNT_SCOPE]: "Manage your settings, accounts, and configuration",
	[MCP_CALENDAR_SCOPE]: "Manage your calendars, events, tasks, and invitations",
	[MCP_OPERATOR_SCOPE]: "Administer this remit server",
	[OFFLINE_ACCESS_SCOPE]: "Stay connected until you disconnect it",
};

export const describeScopes = (scopes: readonly string[]): McpPermission[] =>
	scopes.map((scope) => ({
		scope,
		description: SCOPE_DESCRIPTIONS[scope] ?? `Use the "${scope}" permission`,
	}));
