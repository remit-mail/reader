import type {
	IAccountRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";

export interface SearchIndexDataPorts {
	account: IAccountRepository;
	threadMessage: IThreadMessageRepository;
	/**
	 * Resolve the owning accountId for a message whose queue envelope carries no
	 * accountId of its own. The DynamoDB stream bridge resolves accountId at
	 * publish time, so every AWS search-index message already carries a real
	 * one — this hook is `undefined` there, and the handler uses the message's
	 * own `accountId` unchanged (see `prepareUpsert` in handler.ts).
	 *
	 * The outbox carries a plain `message_id`, so the relational drain has no
	 * accountId to attach; this hook derives it from the message's mailbox at
	 * consume time instead. Returns null when the mailbox can't be resolved (the
	 * message is skipped, not retried — see handler.ts).
	 */
	resolveAccountId?: (messageId: string) => Promise<string | null>;
}

// `@remit/drizzle-service` is loaded lazily, inside this function, instead of as
// a static top-level import. A static import is bundled (and evaluated at module
// load) regardless of whether the branch that uses it ever runs; the package is
// marked `external` for the Lambda esbuild build (see LAMBDA_ESBUILD_OPTIONS),
// so esbuild leaves this `import()` unresolved in the bundle. It resolves only
// where the relational composition actually runs, which has the package
// installed. Mirrors `packages/backend/src/service/data-client.ts`.
const buildSqliteDataPorts = async (): Promise<SearchIndexDataPorts> => {
	const sqliteDbPath = process.env.SQLITE_DB_PATH;
	if (!sqliteDbPath) throw new Error("SQLITE_DB_PATH is required");

	const {
		AccountRepo,
		createSqliteDatabase,
		DrizzleMessageRepository,
		DrizzleThreadMessageRepository,
		MailboxRepo,
		messageDataSchema,
	} = await import("@remit/drizzle-service");

	const { db } = await createSqliteDatabase(messageDataSchema, {
		filename: sqliteDbPath,
	});

	const message = new DrizzleMessageRepository(db);
	const mailbox = new MailboxRepo(db);

	return {
		account: new AccountRepo(db),
		threadMessage: new DrizzleThreadMessageRepository(db),
		resolveAccountId: async (messageId) => {
			const row = await message.get(messageId);
			return mailbox.resolveAccountId(row.mailboxId);
		},
	};
};

let injectedDataPorts: SearchIndexDataPorts | null = null;

/**
 * Register the DynamoDB-backed search-index data ports from the composition
 * root. The relational backend composes in-package above and never touches this
 * seam.
 */
export const setSearchIndexDataPorts = (ports: SearchIndexDataPorts): void => {
	injectedDataPorts = ports;
};

/**
 * The search-index data ports for this process: the ones a composition root
 * registered, or — for a process that registered none — the SQLite composition
 * this build contains. `SQLITE_DB_PATH` is that composition's precondition, not
 * a backend selection.
 */
export const buildDataPortsFromEnv =
	async (): Promise<SearchIndexDataPorts> => {
		if (injectedDataPorts) return injectedDataPorts;
		if (process.env.SQLITE_DB_PATH) return buildSqliteDataPorts();
		throw new Error(
			"no search-index data ports registered — register them with setSearchIndexDataPorts() from your composition root",
		);
	};
