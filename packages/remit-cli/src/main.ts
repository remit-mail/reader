import { spawnSync } from "node:child_process";
import {
	configOperationsGetConfig,
	syncOperationsTriggerSync,
} from "@remit/api-http-client";
import { client } from "@remit/api-http-client/client.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	type AccessAuth,
	accessHeaders,
	loginCommand,
	selectAuth,
	type TokenRun,
} from "./auth.ts";
import { resolveTarget, type Target } from "./target.ts";

interface Connection {
	readonly target: Target;
	readonly auth: AccessAuth;
	readonly headers: Readonly<Record<string, string>>;
}

const fail = (message: string): never => {
	process.stderr.write(`remit: ${message}\n`);
	process.exit(1);
};

const runCloudflared = (appUrl: string): TokenRun => {
	const result = spawnSync(
		"cloudflared",
		["access", "token", `-app=${appUrl}`],
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

const connect = (): Connection => {
	const resolved = resolveTarget(process.env.REMIT_API_URL);
	if (!resolved.ok) return fail(resolved.message);
	const chosen = selectAuth(process.env);
	if (!chosen.ok) return fail(chosen.message);
	const headers = accessHeaders(
		chosen.auth,
		resolved.target.appUrl,
		runCloudflared,
	);
	if (!headers.ok) return fail(headers.message);
	client.setConfig({
		baseUrl: resolved.target.apiUrl,
		headers: headers.headers,
		redirect: "manual",
	});
	return {
		target: resolved.target,
		auth: chosen.auth,
		headers: headers.headers,
	};
};

const refusal = (
	connection: Connection,
	what: string,
	response: Response | undefined,
	error: unknown,
): string => {
	if (response === undefined) {
		const reason = error instanceof Error ? error.message : String(error);
		return `${what}: could not reach ${connection.target.apiUrl}: ${reason}`;
	}
	const accessRefused =
		response.status === 401 ||
		response.status === 403 ||
		(response.status >= 300 && response.status < 400);
	if (accessRefused && connection.auth.kind === "ServiceToken") {
		return `${what}: Cloudflare Access refused the service token (${response.status}): check CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET against the Access policy`;
	}
	if (accessRefused) {
		return `${what}: Cloudflare Access refused the token (${response.status}): run '${loginCommand(connection.target.appUrl)}'`;
	}
	if (response.ok) {
		return `${what}: ${connection.target.apiUrl} answered ${response.status} without a JSON body; is REMIT_API_URL the API root, e.g. https://app.remit.email/api?`;
	}
	return `${what}: ${connection.target.apiUrl} answered ${response.status} ${response.statusText}`;
};

const isCommit = (value: unknown): value is { commit: string } =>
	typeof value === "object" &&
	value !== null &&
	"commit" in value &&
	typeof value.commit === "string";

const deployedCommit = async (connection: Connection): Promise<string> => {
	const response = await fetch(`${connection.target.apiUrl}/version`, {
		headers: connection.headers,
		redirect: "manual",
	});
	const text = response.ok ? await response.text() : "";
	const body: unknown = text.startsWith("{") ? JSON.parse(text) : undefined;
	if (!isCommit(body))
		return fail(refusal(connection, "GET /version", response, undefined));
	return body.commit;
};

const accountsOf = async (
	connection: Connection,
): Promise<readonly RemitImapAccountResponse[]> => {
	const { data, error, response } = await configOperationsGetConfig();
	if (data === undefined)
		return fail(refusal(connection, "GET /config", response, error));
	return data.accounts;
};

const lastSync = (account: RemitImapAccountResponse): string =>
	account.lastSyncAt === undefined
		? "never synced"
		: `synced ${new Date(account.lastSyncAt).toISOString()}`;

const accountLine = (account: RemitImapAccountResponse): string =>
	[
		`  ${account.email}`,
		account.accountId,
		account.connectionState,
		lastSync(account),
		account.lastError ?? "",
	]
		.filter((field) => field !== "")
		.join("  ");

const status = async (args: readonly string[]): Promise<void> => {
	if (args.length > 0) fail(`status: unknown argument '${args[0]}'`);
	const connection = connect();
	const commit = await deployedCommit(connection);
	const accounts = await accountsOf(connection);
	process.stdout.write(
		[
			`Target:   ${connection.target.apiUrl}`,
			`Commit:   ${commit}`,
			`Accounts: ${accounts.length}`,
			...accounts.map(accountLine),
			"",
		].join("\n"),
	);
};

const sync = async (args: readonly string[]): Promise<void> => {
	const [wanted, extra] = args;
	if (wanted === undefined || extra !== undefined) {
		fail("sync: name one account, by email or id; 'remit status' lists them");
	}
	const connection = connect();
	const accounts = await accountsOf(connection);
	const account =
		accounts.find((a) => a.accountId === wanted || a.email === wanted) ??
		fail(`sync: no account '${wanted}'; 'remit status' lists them`);
	const { data, error, response } = await syncOperationsTriggerSync({
		path: { accountId: account.accountId },
	});
	if (data === undefined)
		return fail(
			refusal(
				connection,
				`POST /accounts/${account.accountId}/sync`,
				response,
				error,
			),
		);
	process.stdout.write(`${account.email}: ${data.message}\n`);
};

const COMMANDS: Readonly<
	Record<string, (args: readonly string[]) => Promise<void>>
> = { status, sync };

const [command = "", ...rest] = process.argv.slice(2);
const run =
	COMMANDS[command] ??
	fail(`'${command}' has no remote form; remote commands are: status, sync`);
await run(rest);
