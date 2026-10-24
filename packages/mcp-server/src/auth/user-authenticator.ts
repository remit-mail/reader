import { auth_account, auth_user } from "@remit/auth-service/schema";
import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export interface Credentials {
	email: string;
	password: string;
}

export interface AuthenticatedUser {
	id: string;
	email: string;
	name: string;
}

export type Authentication =
	| { ok: true; user: AuthenticatedUser }
	| { ok: false };

export interface UserAuthenticator {
	authenticate(credentials: Credentials): Promise<Authentication>;
}

const CREDENTIAL_PROVIDER = "credential";

export const createRemitPasswordAuthenticator = (
	db: BetterSQLite3Database,
): UserAuthenticator => ({
	async authenticate({ email, password }) {
		const [row] = await db
			.select({
				id: auth_user.id,
				email: auth_user.email,
				name: auth_user.name,
				hash: auth_account.password,
			})
			.from(auth_user)
			.innerJoin(
				auth_account,
				and(
					eq(auth_account.userId, auth_user.id),
					eq(auth_account.providerId, CREDENTIAL_PROVIDER),
				),
			)
			.where(eq(auth_user.email, email.trim().toLowerCase()))
			.limit(1);
		if (!row?.hash) return { ok: false };
		if (!(await verifyPassword({ hash: row.hash, password }))) {
			return { ok: false };
		}
		return { ok: true, user: { id: row.id, email: row.email, name: row.name } };
	},
});
