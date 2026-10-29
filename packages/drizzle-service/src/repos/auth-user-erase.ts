import { auth_user } from "@remit/auth-service/schema";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { SqliteStore } from "../db.js";
import type { CascadeDeleteLogger } from "./cascade-delete.js";
import { inList } from "./in-list.js";

// An AccountConfig keeps only the id derived from its login user, so the user
// is found by deriving every id. Its sessions, accounts and MCP grants go with
// it through the cascading foreign keys of the auth tables.
export const eraseAuthUserOf = async (
	app: SqliteStore<Record<string, unknown>>,
	accountConfigId: string,
	log: CascadeDeleteLogger,
): Promise<void> => {
	const userIds = (await app.db.select({ id: auth_user.id }).from(auth_user))
		.map((row) => row.id)
		.filter((id) => deriveAccountConfigId(id) === accountConfigId);
	await app.db.delete(auth_user).where(inList(auth_user.id, userIds));
	log.info(
		{ accountConfigId, userCount: userIds.length },
		"Auth user erase complete",
	);
};
