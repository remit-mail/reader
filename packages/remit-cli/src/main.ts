import { spawnSync } from "node:child_process";
import { client } from "@remit/api-http-client/client.gen.ts";
import { authHeaders, selectAuth, type TokenRun } from "./auth.ts";
import { COMMANDS, fail, USAGE } from "./commands.ts";
import { signIn } from "./session.ts";
import { parseInvocation } from "./target.ts";

const runCloudflared = (origin: string): TokenRun => {
	const result = spawnSync(
		"cloudflared",
		["access", "token", `-app=${origin}`],
		{
			encoding: "utf8",
			timeout: 30_000,
		},
	);
	if (
		result.error !== undefined &&
		"code" in result.error &&
		result.error.code === "ENOENT"
	) {
		return { kind: "Missing" };
	}
	if (result.status !== 0) return { kind: "Ran", stdout: "" };
	return { kind: "Ran", stdout: result.stdout };
};

const invocation = parseInvocation(process.argv.slice(2), process.env);
if (!invocation.ok) fail(invocation.message);

const { target, command, args } = invocation;
if (command === "help" || command === "--help" || command === "-h") {
	process.stdout.write(`${USAGE}\n`);
	process.exit(0);
}

const run =
	COMMANDS[command] ??
	fail(
		`'${command}' is not an API command; the API commands are ${Object.keys(COMMANDS).join(", ")}, and the rest run on the VM`,
	);

const chosen = selectAuth(target.kind, process.env);
if (!chosen.ok) fail(chosen.message);

const headers = await authHeaders(chosen.auth, target, {
	runCloudflared,
	signIn,
});
if (!headers.ok) fail(headers.message);

client.setConfig({
	baseUrl: target.apiUrl,
	headers: headers.headers,
	redirect: "manual",
});

await run({ target, auth: chosen.auth }, args);
