import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AccountAuthType,
	CanonicalMailboxRole,
	FilterClauseField,
	LabelColor,
	MessageCategory,
} from "@remit/domain-enums";
import {
	AccountSchema,
	AddressFlagsEntrySchema,
	FilterSchema,
	FolderOverrideSchema,
	LabelSchema,
	MessageDecisionsSchema,
	ReaderConfigDocumentSchema,
} from "./document.js";
import { readGoldenConfigDocument } from "./fixtures.js";

const goldenAccount = () =>
	structuredClone(
		(readGoldenConfigDocument() as { accounts: unknown[] }).accounts[0],
	) as Record<string, unknown>;

test("the account schema is strict at every level it defines", () => {
	for (const mutate of [
		(account: Record<string, unknown>) => {
			account.legacyField = 1;
		},
		(account: Record<string, unknown>) => {
			(account.imap as Record<string, unknown>).compress = true;
		},
		(account: Record<string, unknown>) => {
			(account.signature as Record<string, unknown>).markdown = "";
		},
	]) {
		const account = goldenAccount();
		mutate(account);

		assert.equal(AccountSchema.safeParse(account).success, false);
	}
});

test("an account declares which credential it needs, and never more", () => {
	const account = goldenAccount();
	account.credentials = { required: "certificate" };

	assert.equal(AccountSchema.safeParse(account).success, false);
});

test("enum values come from the domain, so a stale spelling is rejected", () => {
	const account = goldenAccount();
	account.authType = "oauthGoogle";
	assert.equal(AccountSchema.safeParse(account).success, false);

	account.authType = AccountAuthType.OauthMicrosoft;
	assert.equal(AccountSchema.safeParse(account).success, true);

	assert.equal(
		LabelSchema.safeParse({ name: "x", color: "Chartreuse" }).success,
		false,
	);
	assert.equal(
		LabelSchema.safeParse({ name: "x", color: LabelColor.Teal }).success,
		true,
	);
});

test("folder roles and overrides travel by IMAP path", () => {
	const account = goldenAccount();
	account.folderRoles = [
		{ role: CanonicalMailboxRole.Archive, mailboxId: "not-a-path" },
	];

	assert.equal(AccountSchema.safeParse(account).success, false);

	assert.equal(
		FolderOverrideSchema.safeParse({
			folderPath: "INBOX.Lists",
			displayName: "",
			muted: null,
		}).success,
		true,
	);
});

test("a filter names its label by name and its folder by account and path", () => {
	const filter = {
		name: "keep",
		scope: "Standing",
		expiresAt: null,
		matchOperator: "And",
		literalClauses: [{ field: FilterClauseField.ListId, value: "x.example" }],
		actionLabelName: "Facturen",
		actionFolder: {
			accountId: "6f4c2c30-9a2c-4a7f-9f9f-1f2c3d4e5a6b",
			folderPath: "INBOX.Facturen",
		},
		anchor: null,
	};

	assert.equal(FilterSchema.safeParse(filter).success, true);
	assert.equal(
		FilterSchema.safeParse({ ...filter, actionLabelId: "Facturen" }).success,
		false,
	);
	assert.equal(
		FilterSchema.safeParse({
			...filter,
			actionFolder: { mailboxId: "6f4c2c30-9a2c-4a7f-9f9f-1f2c3d4e5a6b" },
		}).success,
		false,
	);
});

test("a filter anchor carries its source text and no vector", () => {
	const anchored = {
		name: "like this",
		scope: "Standing",
		expiresAt: null,
		matchOperator: "And",
		literalClauses: [],
		actionLabelName: null,
		actionFolder: null,
		anchor: {
			sourceText: "the release note we file every month",
			embeddingId: "amazon.titan-embed-text-v2:0@1024",
			sourceMessageId: "2c9e4b11-7d5a-4f60-9a31-5b8c0e7f2d44",
		},
	};

	assert.equal(FilterSchema.safeParse(anchored).success, true);
	assert.equal(
		FilterSchema.safeParse({
			...anchored,
			anchor: {
				sourceText: "x",
				embeddingId: "m@1",
				sourceMessageId: "2c9e4b11-7d5a-4f60-9a31-5b8c0e7f2d44",
				anchorEmbedding: [0.1, 0.2],
			},
		}).success,
		false,
	);
});

test("an address flag keeps its whole payload", () => {
	const entry = {
		normalizedEmail: "post@bank.example",
		displayName: "Bank",
		flags: {
			blocked: {
				value: true,
				setAt: 1750000000000,
				setBy: "web-client",
				expiresAt: 1790000000000,
				reason: "phishing",
			},
			category: {
				value: MessageCategory.transactional,
				setAt: 1750000000000,
			},
		},
	};

	const parsed = AddressFlagsEntrySchema.parse(entry);

	assert.deepEqual(parsed, entry);
	assert.equal(
		AddressFlagsEntrySchema.safeParse({
			...entry,
			flags: { blocked: true },
		}).success,
		false,
	);
});

test("an unknown flag key is refused, so a flag is added deliberately", () => {
	assert.equal(
		AddressFlagsEntrySchema.safeParse({
			normalizedEmail: "a@b.example",
			displayName: "",
			flags: { shouted: { value: true, setAt: 1 } },
		}).success,
		false,
	);
});

test("the two derived flags have no place in the file", () => {
	for (const flag of ["wellknown", "junkOnly"]) {
		assert.equal(
			AddressFlagsEntrySchema.safeParse({
				normalizedEmail: "a@b.example",
				displayName: "",
				flags: { [flag]: { value: true, setAt: 1 } },
			}).success,
			false,
		);
	}
});

test("the reserved decisions slot is defined and empty", () => {
	assert.equal(MessageDecisionsSchema.safeParse([]).success, true);
	assert.equal(MessageDecisionsSchema.safeParse([{}]).success, false);
});

test("the document schema refuses an unknown top-level section", () => {
	const source = readGoldenConfigDocument() as Record<string, unknown>;

	assert.equal(
		ReaderConfigDocumentSchema.safeParse({ ...source, savedSearches: [] })
			.success,
		false,
	);
});
