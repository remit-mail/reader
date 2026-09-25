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
import { deleteServerMailbox, listServerMailboxes } from "../src/imap.js";
import { provisionIsolatedRun } from "../src/provision.js";

const STAMP = Date.now();
const LABEL_NAME = `Facturen ${STAMP}`;
const FILTER_NAME = `Bonnetjes ${STAMP}`;
const SENDER = `webshop-${STAMP}@remit.test`;
const IMPORTED_FOLDER = `Imported-${STAMP}`;

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

/**
 * An identifier in the form the document declares: a UUID re-encoded base36 to
 * a fixed 25 characters, which is what every reader id is on the wire. A
 * shorter stand-in is refused by the format before the import sees it.
 */
const mintStoredId = (): string =>
	Array.from(
		{ length: 25 },
		() =>
			"0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 36)],
	).join("");

/**
 * Re-key the one field two coexisting configurations cannot share, and point
 * the rule at a folder the account does not have, so the import has one to
 * create.
 */
const withFreshAccountId = (
	document: Record<string, unknown>,
	accountId: string,
): Record<string, unknown> => {
	const accounts = document.accounts as Array<Record<string, unknown>>;
	const filters = document.filters as Array<Record<string, unknown>>;
	return {
		...document,
		accounts: accounts.map((account) => ({ ...account, accountId })),
		filters: filters.map((filter) =>
			filter.name === FILTER_NAME
				? {
						...filter,
						actionFolder: { accountId, folderPath: IMPORTED_FOLDER },
					}
				: filter,
		),
	};
};

const leafOf = (path: string): string | undefined => path.split(/[./]/).pop();

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

		const importedAccountId = mintStoredId();
		const document = withFreshAccountId(exported.document, importedAccountId);

		const target = await freshInstance("E2E Config Import");

		// The dry run writes nothing and answers with the report an apply would.
		// Errors first: a refusal says why, and `valid` alone would not.
		const dryRun = await target.importConfig({ document, mode: "validate" });
		expect(dryRun.errors).toEqual([]);
		expect(dryRun.valid).toBe(true);
		expect(dryRun.applied).toBe(false);
		expect(
			dryRun.items.some(
				(entry) => entry.section === "labels" && entry.key === LABEL_NAME,
			),
		).toBe(true);
		expect((await target.getConfig()).accounts).toEqual([]);

		const applied = await target.importConfig({ document, mode: "apply" });
		expect(applied.errors).toEqual([]);
		expect(applied.applied).toBe(true);
		expect(applied.accountsNeedingCredentials).toEqual([importedAccountId]);

		// Server truth: the rows are in the second instance's own configuration.
		const labels = await target.listLabels(importedAccountId);
		expect(labels.map((label) => label.name)).toContain(LABEL_NAME);

		const filters = await target.listFilters(importedAccountId);
		const landedFilter = filters.find((filter) => filter.name === FILTER_NAME);
		expect(landedFilter?.state).toBe("Disabled");
		expect(landedFilter?.disabledReason).toBe("AwaitingFolder");

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

		// `isActive` is what the PATCH above set, so asserting it would only prove
		// the spec's own write. `connectionState` is the mail server's answer: the
		// imap worker writes `authenticated` once it has actually logged in with
		// the credential that was entered, and nothing else can produce it.
		const connected = await waitFor(
			() => target.getConfig(),
			(config) =>
				config.accounts.some(
					(account) =>
						account.accountId === importedAccountId &&
						account.connectionState === "authenticated",
				),
			{
				timeoutMs: 120_000,
				what: "the imported account to authenticate with the entered password",
			},
		);
		expect(
			connected.accounts.find(
				(account) => account.accountId === importedAccountId,
			)?.connectionState,
		).toBe("authenticated");

		// The folder the file named and the account lacked now exists on the mail
		// server itself, created by the import, not by this spec.
		const serverPaths = await waitFor(
			async () => {
				await target.triggerSync(importedAccountId);
				return listServerMailboxes(source.imapUser);
			},
			(paths) => paths.some((path) => leafOf(path) === IMPORTED_FOLDER),
			{
				timeoutMs: 120_000,
				what: "the imported rule's folder to be created on the mail server",
			},
		);
		const createdPath = serverPaths.find(
			(path) => leafOf(path) === IMPORTED_FOLDER,
		);

		// And the rule turned itself on, bound to the folder the server confirmed.
		const running = await waitFor(
			async () => {
				await target.triggerSync(importedAccountId);
				return target.listFilters(importedAccountId);
			},
			(list) =>
				list.some(
					(filter) =>
						filter.name === FILTER_NAME &&
						filter.state === "Active" &&
						filter.actionMailboxId !== "None",
				),
			{
				timeoutMs: 120_000,
				what: "the imported rule to bind to its created folder and turn on",
			},
		);
		const bound = running.find((filter) => filter.name === FILTER_NAME);
		expect(bound?.disabledReason).toBe("None");
		const folder = (await target.listMailboxes(importedAccountId)).find(
			(box) => box.mailboxId === bound?.actionMailboxId,
		);
		expect(folder?.fullPath).toBe(createdPath);

		if (createdPath) await deleteServerMailbox(source.imapUser, createdPath);
	});
});
