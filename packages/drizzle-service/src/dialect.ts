// The SQL dialect this process runs against (RFC 036 D1). One deployment is
// one backend, chosen once at startup by `DATA_BACKEND`: `sqlite` selects the
// SQLite entity tables, outbox table, transaction strategy, and search
// predicates; anything else keeps the Postgres behavior that predates this
// switch. Read once at module load — the repos and schema facade branch on it,
// and a single process never mixes dialects.

export type SqlDialect = "postgres" | "sqlite";

export const SQL_DIALECT: SqlDialect =
	process.env.DATA_BACKEND === "sqlite" ? "sqlite" : "postgres";

export const isSqlite = (): boolean => SQL_DIALECT === "sqlite";
