// The dialect-selected entity table set (RFC 036 D1). Both generated packages
// export the same table symbols under the same names — they differ only in the
// column builders (`pgTable`/`jsonb`/`timestamp` vs `sqliteTable`/`text(json)`/
// `integer`). A process runs one dialect (see ../dialect.ts), so the active set
// is chosen once here and re-exported through the schema facades the repos
// import from.
//
// The cast to the Postgres module type is the single "typing loosens at the
// injection boundary" point RFC 036 D1 names: the repos are written once
// against the Postgres-typed shape, and at runtime the SQLite tables carry
// their own dialect so the queries generate the correct SQL. The backend
// already crosses this boundary with a cast on the db handle.
import * as pgEntities from "@remit/drizzle-pg-schema";
import * as sqliteEntities from "@remit/drizzle-sqlite-schema";
import { isSqlite } from "../dialect.js";

export const entities: typeof pgEntities = isSqlite()
	? (sqliteEntities as unknown as typeof pgEntities)
	: pgEntities;
