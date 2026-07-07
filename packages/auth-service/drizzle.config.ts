const url =
	process.env.DATABASE_URL ??
	process.env.PG_CONNECTION_URL ??
	"postgresql://remit:remit@localhost:5432/remit_dev";

/**
 * The better-auth identity tables share the pg-parity database with the entity
 * schema (remit-drizzle-service). `tablesFilter` scopes drizzle-kit to only the
 * auth tables so a push here never proposes dropping the entity tables it does
 * not know about.
 */
export default {
	dialect: "postgresql",
	schema: "./src/schema/auth-schema.ts",
	out: "./.drizzle",
	dbCredentials: { url },
	tablesFilter: [
		"auth_user",
		"auth_session",
		"auth_account",
		"auth_verification",
		"auth_jwks",
	],
};
