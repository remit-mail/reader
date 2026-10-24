export interface McpServerConfig {
	origin: string;
	secret: string;
	sqliteDbPath: string;
	port: number;
	bodySyncQueueUrl: string | undefined;
	mailboxQueueUrl: string;
	trustedProxies: ReadonlySet<string>;
}

const MIN_SECRET_LENGTH = 32;
const DEFAULT_PORT = 8790;

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required MCP server env var: ${name}`);
	return value;
};

const parseOrigin = (raw: string): string => {
	if (!URL.canParse(raw)) {
		throw new Error(`MCP_PUBLIC_ORIGIN is not a URL: ${raw}`);
	}
	const url = new URL(raw);
	if (url.origin !== raw.replace(/\/$/, "")) {
		throw new Error(
			`MCP_PUBLIC_ORIGIN must be a bare origin such as https://mcp.example.com, got ${raw}`,
		);
	}
	return url.origin;
};

const parsePort = (raw: string | undefined): number => {
	if (!raw) return DEFAULT_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`MCP_PORT is not a port number: ${raw}`);
	}
	return port;
};

export const resolveMcpServerConfig = (): McpServerConfig => {
	const secret = required("MCP_AUTH_SECRET");
	if (secret.length < MIN_SECRET_LENGTH) {
		throw new Error(
			`MCP_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
		);
	}
	return {
		origin: parseOrigin(required("MCP_PUBLIC_ORIGIN")),
		secret,
		sqliteDbPath: required("SQLITE_DB_PATH"),
		port: parsePort(process.env.MCP_PORT),
		bodySyncQueueUrl: process.env.SQS_QUEUE_URL_BODY,
		mailboxQueueUrl: required("SQS_QUEUE_URL"),
		trustedProxies: new Set(
			(process.env.MCP_TRUSTED_PROXIES ?? "")
				.split(",")
				.map((address) => address.trim())
				.filter((address) => address.length > 0),
		),
	};
};
