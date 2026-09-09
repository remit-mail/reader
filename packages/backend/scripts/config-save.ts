import { readConfigForExport } from "@remit/config-transfer";
import { env } from "expect-env";
// Reached by module path rather than through either package's entry point, the
// same way the migrate entrypoint reaches its repairs: this file is bundled by
// esbuild, and a barrel import would drag every repository and the native
// driver behind it into a script that reads one table.
import { auth_user } from "../../auth-service/src/schema/auth-schema-sqlite.js";
import { createSqliteDatabase } from "../../drizzle-service/src/sqlite-client.js";
import { deriveAccountConfigId } from "../src/auth.js";
import { getClient } from "../src/service/data-client.js";
import { exportIdentity } from "../src/service/export-identity.js";

/**
 * `remit config save` (issue #1021). Writes one configuration out as a
 * versioned JSON document on stdout, over the same reader the export endpoint
 * uses. Ships as an alternate entrypoint in the backend image — "the backend
 * image with a command", the shape `migrate.mjs` and `backfill-list-id.mjs`
 * already use — because the operator runs it before a migration drops the
 * database, with no browser and no session to authenticate.
 *
 * The document goes to stdout and never to a path inside the container: the
 * wrapper redirects it to a host file, so the file lands where the operator can
 * see it and with their ownership, rather than root-owned inside a volume.
 */

const USAGE = `Usage: node config-save.mjs [--user <email>]

Writes the configuration as a versioned JSON document to stdout. Contains no
credential: each account records which one it will need back instead.

  --user <email>  Which sign-in to export. Optional on an instance that holds
                  exactly one configuration.
`;

interface Options {
	user: string | undefined;
}

const parseArguments = (argv: readonly string[]): Options => {
	const options: Options = { user: undefined };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--user") {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new Error("--user needs an email address");
			}
			options.user = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown option '${argument}'`);
	}
	return options;
};

/**
 * The configuration behind a sign-in. Identity lives in better-auth's own
 * tables in the same database file, and the configuration id derives from the
 * user id, so the email on the sign-in screen is the one thing an operator can
 * be expected to know.
 */
const accountConfigIdForUser = async (email: string): Promise<string> => {
	const { db, close } = await createSqliteDatabase(
		{ auth_user },
		{ filename: env.SQLITE_DB_PATH },
	);
	try {
		const users = await db
			.select({ id: auth_user.id, email: auth_user.email })
			.from(auth_user);
		// Matched in JS rather than in the query: an address is
		// case-insensitive on the part that matters, and which collation the
		// column happens to carry is not something an operator should have to
		// know before their own email matches.
		const wanted = email.toLowerCase();
		const user = users.find((row) => row.email.toLowerCase() === wanted);
		if (!user) throw new Error(`no user signs in as ${email}`);
		return deriveAccountConfigId(user.id);
	} finally {
		await close();
	}
};

const soleAccountConfigId = async (
	listAll: () => Promise<Array<{ accountConfigId: string }>>,
): Promise<string> => {
	const configs = await listAll();
	const only = configs[0];
	if (!only) throw new Error("this instance holds no configuration to export");
	if (configs.length > 1) {
		throw new Error(
			`this instance holds ${configs.length} configurations — name one with --user <email>`,
		);
	}
	return only.accountConfigId;
};

const run = async (): Promise<void> => {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(USAGE);
		return;
	}

	const options = parseArguments(argv);
	const client = await getClient();
	const accountConfigId = options.user
		? await accountConfigIdForUser(options.user)
		: await soleAccountConfigId(() => client.accountConfig.listAll());

	const document = await readConfigForExport(
		client,
		accountConfigId,
		exportIdentity(),
	);
	process.stdout.write(`${JSON.stringify(document, null, "\t")}\n`);
};

// No `process.exit` on the way out: the document is written to stdout, and
// stdout is a pipe under `compose run`, so exiting drops whatever write is
// still pending. Setting the code and letting the process end delivers it.
await run().catch((error: unknown) => {
	process.stderr.write(
		`config save: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
