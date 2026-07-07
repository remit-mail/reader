const url =
	process.env.DATABASE_URL ??
	process.env.PG_CONNECTION_URL ??
	"postgresql://remit:remit@localhost:5432/remit_dev";

export default {
	dialect: "postgresql",
	schema: "./src/schema.ts",
	out: "./.drizzle",
	dbCredentials: { url },
	// The better-auth identity tables (auth_*) share this database but are owned
	// by remit-auth-service's own drizzle config. Exclude them here so an entity
	// push never proposes dropping tables it does not manage.
	tablesFilter: ["!auth_*"],
};
