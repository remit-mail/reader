import { auth_account, auth_user } from "@remit/auth-service/schema";
import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export type PasswordCheck = { ok: true; userId: string } | { ok: false };

const CREDENTIAL_PROVIDER = "credential";

export const checkRemitPassword = async (
	db: BetterSQLite3Database,
	email: string,
	password: string,
): Promise<PasswordCheck> => {
	const [row] = await db
		.select({ id: auth_user.id, hash: auth_account.password })
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
	return { ok: true, userId: row.id };
};
