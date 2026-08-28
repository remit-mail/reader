/**
 * A configuration crosses from one instance to another (#1021).
 *
 * The migration this exists for drops the database and resyncs mail from IMAP;
 * configuration does not come back that way, so it travels as one exported
 * document. This runs the whole path over the public surface: export a
 * configured instance, import the file into an empty one, hand back the
 * credential the file deliberately omits, and read the result off the server —
 * the label and the rule are rows the second instance now holds, and the
 * account it landed syncs mail once it can log in.
 *
 * The exported account id is rewritten before the import. An account id is a
 * global primary key and both instances live in one database here, so the two
 * configurations cannot both hold the account the file names. Nothing else in
 * the document is touched, and the passthrough itself is pinned by
 * `packages/config-transfer/src/import.test.ts`.
 */
import { ApiClient, fetchBearerToken, signUp, waitFor } from "../src/api.js";
import { imap } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();
const LABEL_NAME = `Facturen ${STAMP}`;
const FILTER_NAME = `Bonnetjes ${STAMP}`;
const SENDER = `webshop-${STAMP}@remit.test`;

const freshInstance = async (label: string): Promise<ApiClient> => {
	const credentials = {
		email: `e2e-import-${STAMP}-${Math.random().toString(36).slice(2, 8)}@remit.test`,
		password: "e2e-password-1234",
		name: label,
	};
	const cookie = await signUp(credentials);
	const token = await fetchBearerToken(cookie);
	return new ApiClient({ ...credentials, token });
};

/** Re-key the one field two coexisting configurations cannot share. */
const withFreshAccountId = (
	document: Record<string, unknown>,
	accountId: string,
): Record<string, unknown> => {
	const accounts = document.accounts as Array<Record<string, unknown>>;
	return {
		...document,
		accounts: accounts.map((account) => ({ ...account, accountId })),
	};
};

test.describe("A configuration file", () => {
	test("carries a label, a rule and an account into an empty instance", async () => {
		test.setTimeout(300_000);

		const source = await provisionIsolatedRun("E2E Config Export");
		const sourceApi = new ApiClient(source);

		await sourceApi.createLabel(source.accountId, LABEL_NAME, "Blue");
		await sourceApi.createFilter(source.accountId, {
			name: FILTER_NAME,
			scope: "Standing",
			literalClauses: [{ field: "From", value: SENDER }],
		});

		const exported = await sourceApi.exportConfig();
		expect(exported.schemaVersion).toBeGreaterThan(0);
		// The whole point of the file: it is safe to copy, so it carries no secret.
		expect(JSON.stringify(exported.document)).not.toContain(imap.password);

		const importedAccountId = `imported-${STAMP}`;
		const document = withFreshAccountId(exported.document, importedAccountId);

		const target = await freshInstance("E2E Config Import");

		// The dry run writes nothing and answers with the report an apply would.
		const dryRun = await target.importConfig({ document, mode: "validate" });
		expect(dryRun.valid).toBe(true);
		expect(dryRun.applied).toBe(false);
		expect(dryRun.errors).toEqual([]);
		expect(
			dryRun.items.some(
				(entry) => entry.section === "labels" && entry.key === LABEL_NAME,
			),
		).toBe(true);
		expect((await target.getConfig()).accounts).toEqual([]);

		const applied = await target.importConfig({ document, mode: "apply" });
		expect(applied.applied).toBe(true);
		expect(applied.errors).toEqual([]);
		expect(applied.accountsNeedingCredentials).toEqual([importedAccountId]);

		// Server truth: the rows are in the second instance's own configuration.
		const labels = await target.listLabels(importedAccountId);
		expect(labels.map((label) => label.name)).toContain(LABEL_NAME);

		const filters = await target.listFilters(importedAccountId);
		expect(filters.map((filter) => filter.name)).toContain(FILTER_NAME);

		// The account landed inactive and marked, because the file carried no
		// password to land it with.
		const landed = (await target.getConfig()).accounts.find(
			(account) => account.accountId === importedAccountId,
		);
		expect(landed?.isActive).toBe(false);
		expect(landed?.connectionState).toBe("credentials_missing");
		expect(landed?.email).toBe(source.imapUser);

		// A second import into a configuration that now holds something refuses
		// rather than writing, and names the mode that would fold it in.
		const refused = await target.attemptImportConfig({
			document,
			mode: "apply",
		});
		expect(refused.status).toBe(409);
		const conflict = (await refused.json()) as { code?: string };
		expect(conflict.code).toBe("config_not_empty");

		// The credential the wizard asks for, entered per account.
		await target.updateAccount(importedAccountId, {
			password: imap.password,
			isActive: true,
		});
		await target.triggerSync(importedAccountId);

		// The account syncs, which is the only proof the credential took.
		const mailboxes = await waitFor(
			() => target.listMailboxes(importedAccountId),
			(list) => list.some((box) => box.fullPath === "INBOX"),
			{
				timeoutMs: 120_000,
				what: "the imported account's INBOX to sync",
			},
		);
		expect(mailboxes.map((box) => box.fullPath)).toContain("INBOX");

		const active = await waitFor(
			() => target.getConfig(),
			(config) =>
				config.accounts.some(
					(account) =>
						account.accountId === importedAccountId && account.isActive,
				),
			{ timeoutMs: 60_000, what: "the imported account to become active" },
		);
		expect(
			active.accounts.find((account) => account.accountId === importedAccountId)
				?.isActive,
		).toBe(true);
	});
});
