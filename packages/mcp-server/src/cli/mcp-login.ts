import { setTimeout } from "node:timers/promises";
import { deviceLogin } from "./device-login.js";

const origin = process.argv[2] ?? process.env.MCP_PUBLIC_ORIGIN;
if (!origin) {
	process.stderr.write(
		"Usage: mcp-login <origin>, or set MCP_PUBLIC_ORIGIN to the MCP server's origin\n",
	);
	process.exit(2);
}

const result = await deviceLogin(new URL(origin).origin, {
	fetch,
	print: (line) => process.stdout.write(`${line}\n`),
	sleep: (ms) => setTimeout(ms),
});

if (!result.ok) {
	const reasons: Record<string, string> = {
		access_denied: "The request was denied on the approval page.",
		expired_token: "The code expired before it was approved. Run this again.",
	};
	process.stderr.write(
		`Signing in failed: ${reasons[result.error] ?? `${result.error} ${result.description}`}\n`,
	);
	process.exit(1);
}

process.stdout.write(
	`\nSigned in. Add remit to Claude Code with:\n\n${result.command}\n`,
);
