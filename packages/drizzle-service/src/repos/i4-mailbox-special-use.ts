import type {
	IMailboxSpecialUseRepository,
	MailboxSpecialUseItem,
	MailboxSpecialUseValue,
} from "@remit/data-ports";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { randomId } from "../id.js";
import { mailboxSpecialUseTable, mailboxTable } from "../schema/i4-mailbox.js";

type DB = NodePgDatabase<Record<string, unknown>>;

function rowToSpecialUse(
	row: typeof mailboxSpecialUseTable.$inferSelect,
): MailboxSpecialUseItem {
	return {
		mailboxSpecialUseId: row.mailboxSpecialUseId,
		mailboxId: row.mailboxId,
		specialUse: row.specialUse as MailboxSpecialUseValue,
	};
}

export class MailboxSpecialUseRepo implements IMailboxSpecialUseRepository {
	constructor(private db: DB) {}

	async create(
		mailboxId: string,
		specialUse: MailboxSpecialUseValue,
	): Promise<MailboxSpecialUseItem> {
		const [row] = await this.db
			.insert(mailboxSpecialUseTable)
			.values({
				mailboxSpecialUseId: randomId(),
				mailboxId,
				specialUse,
			})
			.returning();
		return rowToSpecialUse(row);
	}

	async createMany(
		mailboxId: string,
		specialUses: MailboxSpecialUseValue[],
	): Promise<MailboxSpecialUseItem[]> {
		if (specialUses.length === 0) return [];
		const values = specialUses.map((specialUse) => ({
			mailboxSpecialUseId: randomId(),
			mailboxId,
			specialUse,
		}));
		const rows = await this.db
			.insert(mailboxSpecialUseTable)
			.values(values)
			.returning();
		return rows.map(rowToSpecialUse);
	}

	async listByMailboxId(mailboxId: string): Promise<MailboxSpecialUseItem[]> {
		const rows = await this.db
			.select()
			.from(mailboxSpecialUseTable)
			.where(eq(mailboxSpecialUseTable.mailboxId, mailboxId));
		return rows.map(rowToSpecialUse);
	}

	async deleteByMailboxId(mailboxId: string): Promise<number> {
		const existing = await this.listByMailboxId(mailboxId);
		if (existing.length === 0) return 0;
		await this.db
			.delete(mailboxSpecialUseTable)
			.where(eq(mailboxSpecialUseTable.mailboxId, mailboxId));
		return existing.length;
	}

	async findBySpecialUse(
		accountId: string,
		specialUse: MailboxSpecialUseValue,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		const mailboxes = await this.db
			.select()
			.from(mailboxTable)
			.where(eq(mailboxTable.accountId, accountId));

		for (const mailbox of mailboxes) {
			const entries = await this.listByMailboxId(mailbox.mailboxId);
			if (entries.some((e) => e.specialUse === specialUse)) {
				return { mailboxId: mailbox.mailboxId, fullPath: mailbox.fullPath };
			}
		}
		return null;
	}

	async findInboxMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(eq(mailboxTable.accountId, accountId));
		const found = rows.find((r) => r.fullPath.toUpperCase() === "INBOX");
		return found
			? { mailboxId: found.mailboxId, fullPath: found.fullPath }
			: null;
	}

	async findTrashMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		const bySpecialUse = await this.findBySpecialUse(accountId, "Trash");
		if (bySpecialUse) return bySpecialUse;

		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(eq(mailboxTable.accountId, accountId));

		const names = [
			"trash",
			"deleted items",
			"deleted",
			"[gmail]/trash",
			"[gmail]/bin",
		];
		const found = rows.find((r) => names.includes(r.fullPath.toLowerCase()));
		return found
			? { mailboxId: found.mailboxId, fullPath: found.fullPath }
			: null;
	}

	async findArchiveMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		const bySpecialUse = await this.findBySpecialUse(accountId, "Archive");
		if (bySpecialUse) return bySpecialUse;

		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(eq(mailboxTable.accountId, accountId));

		const names = ["archive", "archives", "[gmail]/all mail"];
		const found = rows.find((r) => names.includes(r.fullPath.toLowerCase()));
		return found
			? { mailboxId: found.mailboxId, fullPath: found.fullPath }
			: null;
	}

	async findJunkMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		const bySpecialUse = await this.findBySpecialUse(accountId, "Junk");
		if (bySpecialUse) return bySpecialUse;

		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(eq(mailboxTable.accountId, accountId));

		const names = ["junk", "spam", "bulk mail", "junk e-mail", "[gmail]/spam"];
		const found = rows.find((r) => names.includes(r.fullPath.toLowerCase()));
		return found
			? { mailboxId: found.mailboxId, fullPath: found.fullPath }
			: null;
	}
}
