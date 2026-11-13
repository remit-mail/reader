import {
	type DomainRegistrationItem,
	type IDomainRegistrationRepository,
	type PutDomainRegistrationInput,
	readStoredDomainRegistration,
} from "@remit/data-ports";
import { eq } from "drizzle-orm";
import type { RepositoryDb } from "../db.js";
import { NotFoundError } from "../error.js";
import { domainRegistrationTable } from "../schema.js";

const toItem = (
	row: typeof domainRegistrationTable.$inferSelect,
): DomainRegistrationItem => ({
	registrableDomain: row.registrableDomain,
	registration: readStoredDomainRegistration(row.registration),
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

export class DomainRegistrationRepo implements IDomainRegistrationRepository {
	constructor(private db: RepositoryDb) {}

	async get(registrableDomain: string): Promise<DomainRegistrationItem> {
		const [row] = await this.db
			.select()
			.from(domainRegistrationTable)
			.where(eq(domainRegistrationTable.registrableDomain, registrableDomain));
		if (!row) {
			throw new NotFoundError(
				`DomainRegistration not found: ${registrableDomain}`,
			);
		}
		return toItem(row);
	}

	async put(
		input: PutDomainRegistrationInput,
	): Promise<DomainRegistrationItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(domainRegistrationTable)
			.values({
				registrableDomain: input.registrableDomain,
				registration: input.registration,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: domainRegistrationTable.registrableDomain,
				set: { registration: input.registration, updatedAt: now },
			})
			.returning();
		if (!row) {
			throw new Error(
				`Failed to upsert DomainRegistration: ${input.registrableDomain}`,
			);
		}
		return toItem(row);
	}
}
