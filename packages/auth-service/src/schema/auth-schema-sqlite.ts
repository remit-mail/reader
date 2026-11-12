// The five better-auth identity tables, in the shape better-auth's drizzle
// adapter emits with `provider: "sqlite"`. Used to generate the committed
// sqlite migrations (deploy/vps/migrations-sqlite/app).
//
// Hand-maintained, deliberately. The `@better-auth/cli generate` command no
// longer emits this shape: it writes `mode: "timestamp_ms"` where these columns
// store seconds, and a SQL `DEFAULT (cast(unixepoch('subsecond') * 1000 as
// integer))` where these use a JS-side `$defaultFn` and the committed migration
// has no DEFAULT clause. Taking its output would reinterpret every timestamp on
// every deployed instance and rewrite all five tables. Match better-auth's
// runtime expectations by hand when a version bump changes them, and let
// vps-migrations-drift.sqlite.test.ts catch the migration side.
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const auth_user = sqliteTable(
	"auth_user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull(),
		emailVerified: integer("email_verified", { mode: "boolean" })
			.default(false)
			.notNull(),
		image: text("image"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		disabled: integer("disabled", { mode: "boolean" }).default(false).notNull(),
		lastSignInAt: integer("last_sign_in_at", { mode: "timestamp" })
			.default(sql`0`)
			.notNull(),
	},
	(table) => [uniqueIndex("auth_user_email_unique").on(table.email)],
);

export const auth_session = sqliteTable(
	"auth_session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		token: text("token").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => auth_user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("auth_session_token_unique").on(table.token),
		index("auth_session_userId_idx").on(table.userId),
	],
);

export const auth_account = sqliteTable(
	"auth_account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => auth_user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", {
			mode: "timestamp",
		}),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", {
			mode: "timestamp",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("auth_account_userId_idx").on(table.userId)],
);

export const auth_verification = sqliteTable(
	"auth_verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const auth_jwks = sqliteTable("auth_jwks", {
	id: text("id").primaryKey(),
	publicKey: text("public_key").notNull(),
	privateKey: text("private_key").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
	alg: text("alg"),
	crv: text("crv"),
});

// Not better-auth tables: the self-host People operations own these
// (packages/auth-service/src/people.ts). Times are epoch milliseconds.
export const identity_audit_event = sqliteTable(
	"identity_audit_event",
	{
		auditEventId: text("audit_event_id").primaryKey(),
		occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
		actor: text("actor").notNull(),
		target: text("target").notNull(),
		action: text("action").notNull(),
		outcome: text("outcome").notNull(),
		clientIp: text("client_ip").notNull(),
	},
	(table) => [
		index("identity_audit_event_occurred_at_idx").on(table.occurredAt),
	],
);

export const identity_step_up = sqliteTable(
	"identity_step_up",
	{
		digest: text("digest").notNull(),
		callerUserId: text("caller_user_id").notNull(),
		action: text("action").notNull(),
		targetUserId: text("target_user_id").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		uniqueIndex("identity_step_up_digest_idx").on(table.digest),
		index("identity_step_up_caller_idx").on(table.callerUserId),
	],
);
