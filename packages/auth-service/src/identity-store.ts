import { randomUUID } from "node:crypto";
import { logger } from "@remit/logger";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type {
	BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AuditAction, AuditRecord } from "./constants.js";
import {
	auth_session,
	auth_user,
	identity_audit_event,
	identity_step_up,
} from "./schema/auth-schema-sqlite.js";

export const HOST_CLIENT_IP = "host";

const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// The MCP connector's tables share the app database. auth-service cannot depend
// on mcp-server, so the four columns a revocation writes are declared here.
const mcp_oauth_consent = sqliteTable("mcp_oauth_consent", {
	userId: text("user_id"),
});
const mcp_oauth_access_token = sqliteTable("mcp_oauth_access_token", {
	userId: text("user_id"),
	revoked: integer("revoked", { mode: "timestamp_ms" }),
});
const mcp_oauth_refresh_token = sqliteTable("mcp_oauth_refresh_token", {
	userId: text("user_id"),
	revoked: integer("revoked", { mode: "timestamp_ms" }),
});
const mcp_session = sqliteTable("mcp_session", {
	userId: text("user_id"),
});

export type IdentityDb = ReturnType<typeof drizzle>;

type SqliteDb = BetterSQLite3Database;

export interface IdentityStore {
	db: IdentityDb;
	immediate<T>(work: () => T): T;
	audit(record: AuditRecord): string;
	relabel(auditEventId: string, record: AuditRecord): void;
	close(): void;
}

const logAudit = (record: AuditRecord): void => {
	// biome-ignore lint/plugin/no-logger-info: an identity audit record is an audit-grade signal
	logger.info({ audit: record }, "Identity audit event");
};

const insertAudit = (db: SqliteDb, record: AuditRecord): string => {
	const now = Date.now();
	const auditEventId = randomUUID();
	db.delete(identity_audit_event)
		.where(
			lt(identity_audit_event.occurredAt, new Date(now - AUDIT_RETENTION_MS)),
		)
		.run();
	db.insert(identity_audit_event)
		.values({ auditEventId, occurredAt: new Date(now), ...record })
		.run();
	return auditEventId;
};

export const writeAudit = (db: SqliteDb, record: AuditRecord): void => {
	insertAudit(db, record);
	logAudit(record);
};

export const identityStore = (db: IdentityDb): IdentityStore => {
	let pending: AuditRecord[] | null = null;
	const sqlite = db.$client;

	const log = (record: AuditRecord): void => {
		if (pending) pending.push(record);
		else logAudit(record);
	};

	const audit = (record: AuditRecord): string => {
		const auditEventId = insertAudit(db, record);
		log(record);
		return auditEventId;
	};

	const relabel = (auditEventId: string, record: AuditRecord): void => {
		db.update(identity_audit_event)
			.set({ action: record.action, outcome: record.outcome })
			.where(eq(identity_audit_event.auditEventId, auditEventId))
			.run();
		log(record);
	};

	const immediate = <T>(work: () => T): T => {
		pending = [];
		const written = pending;
		const result = (() => {
			try {
				return sqlite.transaction(work).immediate();
			} finally {
				pending = null;
			}
		})();
		for (const record of written) logAudit(record);
		return result;
	};

	return { db, immediate, audit, relabel, close: () => sqlite.close() };
};

export const openIdentityStore = async (
	filename: string,
): Promise<IdentityStore> => {
	const { default: Database } = await import("better-sqlite3");
	const { drizzle } = await import("drizzle-orm/better-sqlite3");
	const sqlite = new Database(filename);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("synchronous = NORMAL");
	sqlite.pragma("foreign_keys = ON");
	return identityStore(drizzle({ client: sqlite }));
};

export interface UserRow {
	userId: string;
	email: string;
	disabled: boolean;
	createdAt: Date;
	lastSignInAt: Date;
}

export const findUser = (
	store: IdentityStore,
	userId: string,
): UserRow | undefined =>
	store.db
		.select({
			userId: auth_user.id,
			email: auth_user.email,
			disabled: auth_user.disabled,
			createdAt: auth_user.createdAt,
			lastSignInAt: auth_user.lastSignInAt,
		})
		.from(auth_user)
		.where(eq(auth_user.id, userId))
		.get();

export const isUserDisabled = (db: SqliteDb, userId: string): boolean =>
	db
		.select({ disabled: auth_user.disabled })
		.from(auth_user)
		.where(eq(auth_user.id, userId))
		.get()?.disabled === true;

export const sessionUserOf = (
	store: IdentityStore,
	sessionToken: string,
): { userId: string; disabled: boolean } | undefined =>
	store.db
		.select({ userId: auth_user.id, disabled: auth_user.disabled })
		.from(auth_session)
		.innerJoin(auth_user, eq(auth_user.id, auth_session.userId))
		.where(eq(auth_session.token, sessionToken))
		.get();

export const markSignedIn = (store: IdentityStore, userId: string): void => {
	store.db
		.update(auth_user)
		.set({ lastSignInAt: new Date() })
		.where(eq(auth_user.id, userId))
		.run();
};

export const deleteSessions = (store: IdentityStore, userId: string): void => {
	store.db.delete(auth_session).where(eq(auth_session.userId, userId)).run();
};

export const revokeUser = (store: IdentityStore, userId: string): void => {
	const { db } = store;
	const revoked = new Date();
	deleteSessions(store, userId);
	db.delete(mcp_oauth_consent)
		.where(eq(mcp_oauth_consent.userId, userId))
		.run();
	db.update(mcp_oauth_access_token)
		.set({ revoked })
		.where(
			and(
				eq(mcp_oauth_access_token.userId, userId),
				isNull(mcp_oauth_access_token.revoked),
			),
		)
		.run();
	db.update(mcp_oauth_refresh_token)
		.set({ revoked })
		.where(
			and(
				eq(mcp_oauth_refresh_token.userId, userId),
				isNull(mcp_oauth_refresh_token.revoked),
			),
		)
		.run();
	db.delete(mcp_session).where(eq(mcp_session.userId, userId)).run();
	db.delete(identity_step_up)
		.where(eq(identity_step_up.callerUserId, userId))
		.run();
};

const revokeEveryone = (store: IdentityStore): void => {
	const { db } = store;
	const revoked = new Date();
	db.delete(auth_session).run();
	db.delete(mcp_oauth_consent).run();
	db.update(mcp_oauth_access_token)
		.set({ revoked })
		.where(isNull(mcp_oauth_access_token.revoked))
		.run();
	db.update(mcp_oauth_refresh_token)
		.set({ revoked })
		.where(isNull(mcp_oauth_refresh_token.revoked))
		.run();
	db.delete(mcp_session).run();
	db.delete(identity_step_up).run();
};

export const applySignInSwitch = (
	store: IdentityStore,
	signInEnabled: boolean,
): void => {
	store.immediate(() => {
		if (!signInEnabled) revokeEveryone(store);
		const latest = store.db
			.select({ action: identity_audit_event.action })
			.from(identity_audit_event)
			.where(
				inArray(identity_audit_event.action, ["KillSwitchOn", "KillSwitchOff"]),
			)
			.orderBy(desc(identity_audit_event.occurredAt))
			.limit(1)
			.get();
		const state: AuditAction = signInEnabled ? "KillSwitchOff" : "KillSwitchOn";
		const changed = latest ? latest.action !== state : !signInEnabled;
		if (!changed) return;
		store.audit({
			actor: "env",
			target: "all",
			action: state,
			outcome: "Succeeded",
			clientIp: HOST_CLIENT_IP,
		});
	});
};
