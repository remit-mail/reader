import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	RemitImapConfigImportItemReport,
	RemitImapConfigImportReport,
} from "@remit/api-http-client/types.gen.ts";
import { ApiError } from "./api.js";
import {
	countVerdicts,
	groupReportSections,
	MAX_CONFIG_FILE_BYTES,
	pendingFolders,
	readConfigText,
	readConflict,
	readFailure,
	sectionResults,
	writeFailure,
} from "./config-import.js";

const item = (
	section: string,
	key: string,
	verdict: string,
	reason?: string,
): RemitImapConfigImportItemReport => ({ section, key, verdict, reason });

const reportOf = (
	overrides: Partial<RemitImapConfigImportReport>,
): RemitImapConfigImportReport => ({
	valid: true,
	schemaVersion: 1,
	applied: false,
	items: [],
	errors: [],
	warnings: [],
	accountsNeedingCredentials: [],
	...overrides,
});

test("sections come back in write order, not in the order the report listed them", () => {
	const sections = groupReportSections([
		item("settings", "Density", "updated"),
		item("accounts", "a@example.test", "created"),
		item("filters", "Receipts", "created"),
	]);

	assert.deepEqual(
		sections.map((section) => section.id),
		["accounts", "filters", "settings"],
	);
	assert.deepEqual(
		sections.map((section) => section.title),
		["Accounts", "Rules & filters", "Folders & appearance"],
	);
});

test("a verdict this client does not know reads as rejected, never as an unmarked row", () => {
	const counts = countVerdicts([
		item("accounts", "a@example.test", "created"),
		item("accounts", "b@example.test", "quarantined"),
	]);

	assert.equal(counts.created, 1);
	assert.equal(counts.rejected, 1);
});

test("each read failure gets its own instruction, and carries the server's words", () => {
	const newer = readFailure(
		reportOf({
			valid: false,
			errors: [
				{
					code: "UnsupportedVersion",
					message: "Document schemaVersion 5 was written by a newer reader",
				},
			],
		}),
	);
	assert.equal(newer?.title, "This file was written by a newer Reader");
	assert.match(newer?.fix ?? "", /Update this Reader/);
	assert.match(newer?.raw ?? "", /UnsupportedVersion/);

	const credential = readFailure(
		reportOf({
			valid: false,
			errors: [
				{
					code: "CredentialPresent",
					message: "Credential field at accounts[1]",
				},
			],
		}),
	);
	assert.equal(credential?.title, "The file carries a credential");
	assert.match(credential?.fix ?? "", /change that mailbox's password/);
});

test("an unrecognised error code still says what happened rather than rendering blank", () => {
	const failure = readFailure(
		reportOf({
			valid: false,
			errors: [{ code: "something_new", message: "the store said no" }],
		}),
	);
	assert.equal(failure?.title, "The file could not be imported");
	assert.equal(failure?.explanation, "the store said no");
});

test("a write failure is not a read failure: it routes to the partial screen", () => {
	const report = reportOf({
		applied: true,
		errors: [
			{
				code: "import_write_failed",
				message: "the filter store refused the write",
				details: { section: "filters", key: "Receipts" },
			},
		],
	});

	assert.equal(readFailure(report), undefined);
	assert.equal(writeFailure(report)?.code, "import_write_failed");
});

test("a stopped import splits the write order into landed, failed and never reached", () => {
	const results = sectionResults(
		reportOf({
			applied: true,
			items: [
				item("accounts", "a@example.test", "created"),
				item("labels", "Receipts", "created"),
				item("filters", "Receipts", "rejected", "the store refused"),
			],
			errors: [
				{
					code: "import_write_failed",
					message:
						"the filter store refused the write The items above it were written and remain; the import stopped here.",
					details: { section: "filters", key: "Receipts" },
				},
			],
		}),
	);

	const byId = new Map(results.map((result) => [result.section, result]));
	assert.equal(byId.get("accounts")?.state, "landed");
	assert.equal(byId.get("accounts")?.detail, "1 entry written.");
	assert.equal(byId.get("labels")?.state, "landed");
	assert.equal(byId.get("filters")?.state, "failed");
	assert.equal(byId.get("addressFlags")?.state, "not-attempted");
	assert.equal(byId.get("settings")?.state, "not-attempted");
});

test("a pending folder names the setting waiting on it, and repeats are folded", () => {
	const folders = pendingFolders(
		reportOf({
			warnings: [
				{
					code: "folder_not_found_yet",
					message: "not here yet",
					details: { filter: "Waternet", folderPath: "Projecten/Waternet" },
				},
				{
					code: "folder_not_found_yet",
					message: "not here yet",
					details: { filter: "Waternet", folderPath: "Projecten/Waternet" },
				},
				{
					code: "folder_not_found_yet",
					message: "not here yet",
					details: { folderPath: "Raadsstukken", accountId: "acct-1" },
				},
				{
					code: "anchor_not_embedded",
					message: "carried as text",
					details: { filter: "Waternet" },
				},
			],
		}),
	);

	assert.deepEqual(
		folders.map((folder) => folder.path),
		["Projecten/Waternet", "Raadsstukken"],
	);
	assert.equal(folders[0].waitingFor, "Rule “Waternet”");
	assert.equal(folders[1].accountId, "acct-1");
});

test("a file that is not a configuration is refused before anything is sent", async () => {
	const notJson = await readConfigText("photos.zip", 120, "PK");
	assert.equal(notJson.ok, false);
	assert.equal(
		notJson.ok === false && notJson.failure.title,
		"That file is not JSON",
	);

	const array = await readConfigText("list.json", 20, "[1,2,3]");
	assert.equal(array.ok, false);
	assert.equal(
		array.ok === false && array.failure.title,
		"That is not a Reader config file",
	);

	const huge = await readConfigText(
		"dump.json",
		MAX_CONFIG_FILE_BYTES + 1,
		"{}",
	);
	assert.equal(huge.ok, false);
	assert.match(
		huge.ok === false ? huge.failure.title : "",
		/too large to be a config file/,
	);

	const good = await readConfigText(
		"config.json",
		30,
		'{"kind":"reader.config"}',
	);
	assert.equal(good.ok, true);
	assert.deepEqual(good.ok === true && good.document, {
		kind: "reader.config",
	});
});

test("an unrecognised section gets its own heading rather than being filed under one we know", () => {
	const sections = groupReportSections([
		item("accounts", "a@example.test", "created"),
		item("messageDecisions", "some-message", "created"),
	]);

	assert.deepEqual(
		sections.map((section) => section.id),
		["accounts", "unknown"],
	);
	assert.equal(sections[1].title, "Not recognised");
	assert.match(
		sections[1].entries[0].reason ?? "",
		/does not know the "messageDecisions" section/,
	);
});

test("a write failure that names no section leaves every section unknown, never landed", () => {
	const results = sectionResults(
		reportOf({
			applied: true,
			items: [item("accounts", "a@example.test", "created")],
			errors: [{ code: "import_write_failed", message: "the store refused" }],
		}),
	);

	assert.deepEqual(
		[...new Set(results.map((result) => result.state))],
		["unknown"],
	);
	assert.match(results[0].detail, /without naming where/);
});

test("a write failure naming a section this client does not know is also unknown", () => {
	const results = sectionResults(
		reportOf({
			applied: true,
			errors: [
				{
					code: "import_write_failed",
					message: "the store refused",
					details: { section: "messageDecisions" },
				},
			],
		}),
	);

	assert.deepEqual(
		[...new Set(results.map((result) => result.state))],
		["unknown"],
	);
	assert.match(results[0].detail, /"messageDecisions"/);
});

test("the 409 is read off the wrapper the client throws, not off the error itself", () => {
	const body = {
		code: "config_not_empty",
		message: "already holds configuration",
		details: { accounts: "2" },
	};

	const wrapped = readConflict(new ApiError("already holds", 409, body));
	assert.equal(wrapped?.message, "already holds configuration");
	assert.deepEqual(wrapped?.details, { accounts: "2" });

	// Belt and braces: the same body thrown unwrapped still reaches the screen.
	assert.equal(readConflict(body)?.message, "already holds configuration");
});

test("only the config conflict reads as one", () => {
	assert.equal(
		readConflict(new ApiError("nope", 409, { code: "other" })),
		undefined,
	);
	assert.equal(
		readConflict(new ApiError("nope", 500, { code: "config_not_empty" })),
		undefined,
	);
	assert.equal(readConflict(new Error("boom")), undefined);
});
