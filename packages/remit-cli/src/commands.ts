import { text } from "node:stream/consumers";
import {
	accountOperationsCreateAccount,
	accountOperationsTestConnection,
	configOperationsExportConfig,
	configOperationsGetConfig,
	configOperationsImportConfig,
	filterOperationsListFilters,
	folderRoleOperationsAppointFolderRole,
	mailboxOperationsListMailboxes,
	syncOperationsTriggerSync,
} from "@remit/api-http-client";
import type {
	RemitImapAccountResponse,
	RemitImapCanonicalMailboxRole,
	RemitImapConfigImportReport,
	RemitImapCreateAccountInput,
} from "@remit/api-http-client/types.gen.ts";
import { type Auth, refusalFix } from "./auth.ts";
import { parseOptions } from "./options.ts";
import type { Target } from "./target.ts";

export interface Context {
	readonly target: Target;
	readonly auth: Auth;
}

export type Command = (
	context: Context,
	args: readonly string[],
) => Promise<void>;

export function fail(message: string): never {
	process.stderr.write(`remit: ${message}\n`);
	process.exit(1);
}

const isApiError = (value: unknown): value is { message: string } =>
	typeof value === "object" &&
	value !== null &&
	"message" in value &&
	typeof value.message === "string";

interface Answer<T> {
	readonly data: T | undefined;
	readonly error: unknown;
	readonly response?: Response;
}

const required = <T>(context: Context, what: string, answer: Answer<T>): T => {
	if (answer.data !== undefined) return answer.data;
	const { response, error } = answer;
	if (response === undefined) {
		const reason = error instanceof Error ? error.message : String(error);
		return fail(`${what}: could not reach ${context.target.apiUrl}: ${reason}`);
	}
	const status = response.status;
	if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
		return fail(
			`${what}: ${context.target.apiUrl} refused the sign-in (${status}): ${refusalFix(context.auth, context.target)}`,
		);
	}
	const detail = isApiError(error) ? `: ${error.message}` : "";
	return fail(`${what}: ${context.target.apiUrl} answered ${status}${detail}`);
};

const noArguments = (command: string, args: readonly string[]): void => {
	if (args.length > 0) fail(`${command}: unknown argument '${args[0]}'`);
};

const accountsOf = async (
	context: Context,
): Promise<{
	buildCommit: string;
	accounts: readonly RemitImapAccountResponse[];
}> => required(context, "GET /config", await configOperationsGetConfig());

const findAccount = async (
	context: Context,
	command: string,
	wanted: string | undefined,
): Promise<RemitImapAccountResponse> => {
	if (wanted === undefined) {
		return fail(
			`${command}: name an account, by email or id; 'remit accounts' lists them`,
		);
	}
	const { accounts } = await accountsOf(context);
	return (
		accounts.find((a) => a.accountId === wanted || a.email === wanted) ??
		fail(`${command}: no account '${wanted}'; 'remit accounts' lists them`)
	);
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

const print = (lines: readonly string[]): void => {
	process.stdout.write(`${lines.join("\n")}\n`);
};

const status: Command = async (context, args) => {
	noArguments("status", args);
	const { buildCommit, accounts } = await accountsOf(context);
	print([
		`API:      ${context.target.apiUrl} (${context.target.kind})`,
		`Commit:   ${buildCommit}`,
		`Accounts: ${accounts.length}`,
		...accounts.map(accountLine),
	]);
};

const ACCOUNT_OPTIONS = [
	"email",
	"username",
	"display-name",
	"imap-host",
	"imap-port",
	"smtp-host",
	"smtp-port",
];

const port = (command: string, raw: string): number => {
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		return fail(`${command}: '${raw}' is not a port`);
	}
	return value;
};

const accountInput = (
	command: string,
	args: readonly string[],
): RemitImapCreateAccountInput & { readonly username: string } => {
	const options = parseOptions(command, args, ACCOUNT_OPTIONS);
	if (!options.ok) return fail(options.message);
	const value = (name: string): string | undefined => options.values.get(name);
	const email =
		value("email") ?? fail(`${command}: --email and --imap-host are required`);
	const imapHost =
		value("imap-host") ??
		fail(`${command}: --email and --imap-host are required`);
	const password =
		process.env.REMIT_ACCOUNT_PASSWORD ||
		fail(
			`${command}: set REMIT_ACCOUNT_PASSWORD to the mailbox password; it is never read from the command line`,
		);
	const imapPort = port(command, value("imap-port") ?? "993");
	const smtpHost = value("smtp-host");
	const smtpPort = port(command, value("smtp-port") ?? "465");
	const username = value("username") ?? email;
	const displayName = value("display-name");
	return {
		email,
		username,
		password,
		imapHost,
		imapPort,
		imapTls: imapPort === 993,
		imapStartTls: imapPort !== 993,
		...(displayName === undefined ? {} : { displayName }),
		...(smtpHost === undefined
			? { smtpEnabled: false }
			: {
					smtpEnabled: true,
					smtpHost,
					smtpPort,
					smtpTls: smtpPort === 465,
					smtpStartTls: smtpPort !== 465,
					smtpUsername: username,
					smtpPassword: password,
				}),
	};
};

const accountsList: Command = async (context, args) => {
	noArguments("accounts", args);
	const { accounts } = await accountsOf(context);
	print(accounts.length === 0 ? ["No accounts."] : accounts.map(accountLine));
};

const accountsAdd: Command = async (context, args) => {
	const body = accountInput("accounts add", args);
	const created = required(
		context,
		"POST /accounts",
		await accountOperationsCreateAccount({ body }),
	);
	print([`Added ${created.email} (${created.accountId}).`]);
};

const accountsTest: Command = async (context, args) => {
	const input = accountInput("accounts test", args);
	const tested = required(
		context,
		"POST /accounts/test-connection",
		await accountOperationsTestConnection({ body: input }),
	);
	print([
		`IMAP: ${tested.imapSuccess ? "ok" : `failed: ${tested.imapError ?? ""}`}`,
		...(tested.smtpSuccess === undefined
			? []
			: [
					`SMTP: ${tested.smtpSuccess ? "ok" : `failed: ${tested.smtpError ?? ""}`}`,
				]),
	]);
	if (!tested.imapSuccess || tested.smtpSuccess === false) process.exitCode = 1;
};

const ACCOUNT_SUBCOMMANDS: Readonly<Record<string, Command>> = {
	list: accountsList,
	add: accountsAdd,
	test: accountsTest,
};

const accounts: Command = async (context, args) => {
	const [sub = "list", ...rest] = args;
	const run =
		ACCOUNT_SUBCOMMANDS[sub] ??
		fail(`accounts: unknown subcommand '${sub}'; it takes list, add or test`);
	await run(context, rest);
};

const sync: Command = async (context, args) => {
	const [wanted, extra] = args;
	if (extra !== undefined) fail(`sync: takes one account, not '${extra}'`);
	const account = await findAccount(context, "sync", wanted);
	const triggered = required(
		context,
		`POST /accounts/${account.accountId}/sync`,
		await syncOperationsTriggerSync({ path: { accountId: account.accountId } }),
	);
	print([`${account.email}: ${triggered.message}`]);
};

const configExport: Command = async (context, args) => {
	noArguments("config export", args);
	const exported = required(
		context,
		"GET /config/export",
		await configOperationsExportConfig(),
	);
	process.stdout.write(`${JSON.stringify(exported.document, null, "\t")}\n`);
};

const isDocument = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const reportLines = (report: RemitImapConfigImportReport): string[] => [
	`${report.applied ? "Applied" : "Validated"} schema version ${report.schemaVersion}: ${report.valid ? "valid" : "invalid"}.`,
	...report.errors.map((e) => `  error: ${e.message}`),
	...report.warnings.map((w) => `  warning: ${w.message}`),
	...(report.accountsNeedingCredentials.length > 0
		? [
				`${report.accountsNeedingCredentials.length} account(s) need their password again.`,
			]
		: []),
];

const configImport: Command = async (context, args) => {
	const unknown = args.find((a) => a !== "--apply" && a !== "--merge");
	if (unknown !== undefined) {
		fail(`config import: unknown option '${unknown}'`);
	}
	const raw = (await text(process.stdin)).trim();
	const document: unknown = raw.startsWith("{") ? JSON.parse(raw) : undefined;
	if (!isDocument(document)) {
		return fail(
			"config import: pipe the document on stdin, e.g. remit config import < reader-config.json",
		);
	}
	const report = required(
		context,
		"POST /config/import",
		await configOperationsImportConfig({
			body: {
				document,
				mode: args.includes("--apply") ? "apply" : "validate",
				onExisting: args.includes("--merge") ? "merge" : "abort",
			},
		}),
	);
	print(reportLines(report));
	if (!report.valid) process.exitCode = 1;
};

const CONFIG_SUBCOMMANDS: Readonly<Record<string, Command>> = {
	export: configExport,
	import: configImport,
};

const config: Command = async (context, args) => {
	const [sub = "", ...rest] = args;
	const run =
		CONFIG_SUBCOMMANDS[sub] ??
		fail(`config: unknown subcommand '${sub}'; it takes export or import`);
	await run(context, rest);
};

const ROLES: readonly RemitImapCanonicalMailboxRole[] = [
	"Inbox",
	"Drafts",
	"Sent",
	"Archive",
	"Junk",
	"Trash",
	"All",
	"Flagged",
];

const isRole = (value: string): value is RemitImapCanonicalMailboxRole =>
	ROLES.some((role) => role === value);

const mailboxIdOf = async (
	context: Context,
	account: RemitImapAccountResponse,
	path: string,
): Promise<string> => {
	let continuationToken: string | undefined;
	do {
		const page = required(
			context,
			`GET /accounts/${account.accountId}/mailboxes`,
			await mailboxOperationsListMailboxes({
				path: { accountId: account.accountId },
				query: continuationToken === undefined ? {} : { continuationToken },
			}),
		);
		const found = page.items.find((m) => m.fullPath === path);
		if (found !== undefined) return found.mailboxId;
		continuationToken = page.continuationToken;
	} while (continuationToken !== undefined);
	return fail(`folder-role: ${account.email} has no folder '${path}'`);
};

const folderRole: Command = async (context, args) => {
	const [wanted, role, folder, extra] = args;
	if (role === undefined || folder === undefined || extra !== undefined) {
		fail(
			`folder-role: takes <account> <role> <folder|none>, role one of ${ROLES.join(", ")}`,
		);
	}
	if (role === undefined || !isRole(role)) {
		return fail(`folder-role: role must be one of ${ROLES.join(", ")}`);
	}
	const account = await findAccount(context, "folder-role", wanted);
	const mailboxId =
		folder === "none"
			? null
			: await mailboxIdOf(context, account, folder ?? "");
	required(
		context,
		`PUT /accounts/${account.accountId}/folder-roles/${role}`,
		await folderRoleOperationsAppointFolderRole({
			path: { accountId: account.accountId, role },
			body: { mailboxId },
		}),
	);
	print([
		`${account.email}: ${role} is ${folder === "none" ? "unassigned" : folder}.`,
	]);
};

const filters: Command = async (context, args) => {
	const [wanted, extra] = args;
	if (extra !== undefined) fail(`filters: takes one account, not '${extra}'`);
	const account = await findAccount(context, "filters", wanted);
	const lines: string[] = [];
	let continuationToken: string | undefined;
	do {
		const page = required(
			context,
			`GET /accounts/${account.accountId}/filters`,
			await filterOperationsListFilters({
				path: { accountId: account.accountId },
				query: continuationToken === undefined ? {} : { continuationToken },
			}),
		);
		lines.push(
			...page.items.map(
				(f) =>
					`  ${f.name}  ${f.state}  ${f.literalClauses.map((c) => `${c.field} ${c.value}`).join(` ${f.matchOperator} `)}`,
			),
		);
		continuationToken = page.continuationToken;
	} while (continuationToken !== undefined);
	print(lines.length === 0 ? [`${account.email}: no filters.`] : lines);
};

export const COMMANDS: Readonly<Record<string, Command>> = {
	status,
	accounts,
	sync,
	config,
	"folder-role": folderRole,
	filters,
};

export const USAGE = `API commands (standalone or cloudflare target):
  status                         The serving commit and the accounts.
  accounts [list]                The accounts, with their sync state.
  accounts add|test --email E --imap-host H [--imap-port 993]
      [--username U] [--display-name N] [--smtp-host H] [--smtp-port 465]
                                 Add an account, or only test its connection.
                                 The password comes from REMIT_ACCOUNT_PASSWORD.
  sync <account>                 Start a sync of one account, by email or id.
  config export                  Every setting as one JSON document, on stdout.
  config import [--apply] [--merge]
                                 Validate (or apply) a document read on stdin.
  folder-role <account> <role> <folder|none>
                                 Appoint the folder that plays a role.
  filters <account>              The account's filters.

Target: --target standalone|cloudflare, --api-url URL, or REMIT_API_URL
(cloudflare). Standalone signs in with REMIT_EMAIL and REMIT_PASSWORD, or
REMIT_TOKEN; cloudflare with CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET,
else 'cloudflared access token'.`;
