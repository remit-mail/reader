import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { AccountItem, ClassifierScoreItem } from "@remit/data-ports";
import {
	ClassificationLabel,
	MessageCategory,
	MessageClassificationState,
} from "@remit/domain-enums";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
} from "../test-helpers/test-store.js";
import { readClassifierStats } from "./classifier-stats.js";

const SINCE = "2026-11-01T00:00:00+01:00";
const SINCE_MS = Date.parse(SINCE);
const DAY = 24 * 60 * 60 * 1000;

const score = (
	label: ClassifierScoreItem["label"],
	confident: boolean,
): ClassifierScoreItem => ({
	label,
	confidence: confident ? 0.9 : 0.4,
	confident,
});

let store: Store;
let account: AccountItem;
let uid = 0;

const seed = async (
	mailboxId: string,
	message: {
		internalDate: number;
		category: (typeof MessageCategory)[keyof typeof MessageCategory];
		classifierScores: ClassifierScoreItem[];
		reported?: boolean;
	},
): Promise<void> => {
	uid += 1;
	await seedMessage(store, account, { mailboxId }, uid, {
		message: {
			internalDate: message.internalDate,
			category: message.category,
			classificationState: MessageClassificationState.Examined,
			classifierScores: message.classifierScores,
			...(message.reported
				? { spamReport: { reportedAt: message.internalDate + 1 } }
				: {}),
		},
	});
};

const overrideSender = async (email: string, setAt: number): Promise<void> => {
	const [localPart, domain] = email.split("@");
	await store.address.createAddress({
		addressId: randomUUID(),
		accountConfigId: account.accountConfigId,
		localPart,
		domain,
		normalizedEmail: email,
		normalizedCompound: `${email}:${localPart}`,
		flags: { category: { value: MessageCategory.newsletter, setAt } },
	});
};

before(async () => {
	store = await openStore({ maxBoundParameters: 100 });
	account = await seedAccount(store);
	const inbox = await seedMailbox(store, account, "INBOX");
	const junk = await seedMailbox(store, account, "Junk", {
		specialUse: "Junk",
	});

	await seed(inbox.mailboxId, {
		internalDate: SINCE_MS,
		category: MessageCategory.coldOutreach,
		classifierScores: [
			score(ClassificationLabel.ColdOutreach, true),
			score(ClassificationLabel.Marketing, false),
		],
	});
	await seed(inbox.mailboxId, {
		internalDate: SINCE_MS + DAY,
		category: MessageCategory.personal,
		classifierScores: [score(ClassificationLabel.Personal, true)],
		reported: true,
	});
	await seed(junk.mailboxId, {
		internalDate: SINCE_MS + 2 * DAY,
		category: MessageCategory.marketing,
		classifierScores: [
			score(ClassificationLabel.Spam, true),
			score(ClassificationLabel.Marketing, true),
		],
		reported: true,
	});
	await seed(junk.mailboxId, {
		internalDate: SINCE_MS + 3 * DAY,
		category: MessageCategory.uncategorized,
		classifierScores: [score(ClassificationLabel.Phishing, false)],
		reported: true,
	});
	await seed(inbox.mailboxId, {
		internalDate: SINCE_MS - 1,
		category: MessageCategory.coldOutreach,
		classifierScores: [score(ClassificationLabel.ColdOutreach, true)],
		reported: true,
	});

	await overrideSender("before@example.com", SINCE_MS - 1);
	await overrideSender("after@example.com", SINCE_MS + DAY);
});

after(async () => {
	await store.close();
});

describe("classifier stats", () => {
	it("counts mail from since on across folders and leaves older mail out", async () => {
		const stats = await readClassifierStats(
			store,
			account.accountConfigId,
			SINCE,
		);

		assert.ok(stats.ok);
		assert.equal(stats.value.since, SINCE);
		assert.equal(stats.value.examined, 4);
		assert.deepEqual(stats.value.byCategory, {
			uncategorized: 1,
			personal: 1,
			newsletter: 0,
			marketing: 1,
			automated: 0,
			transactional: 0,
			social: 0,
			coldOutreach: 1,
		});
		assert.deepEqual(stats.value.byLabel, {
			Spam: 1,
			Phishing: 0,
			Priority: 0,
			Personal: 1,
			Newsletter: 0,
			Marketing: 1,
			Automated: 0,
			Transactional: 0,
			Social: 0,
			ColdOutreach: 1,
		});
	});

	it("counts a spam report only when no confident score said junk, and an override only from since on", async () => {
		const stats = await readClassifierStats(
			store,
			account.accountConfigId,
			SINCE,
		);

		assert.ok(stats.ok);
		assert.deepEqual(stats.value.corrections, {
			spamReportedNotJunk: 2,
			categoryOverridden: 1,
		});
	});

	it("refuses a since without a zone offset", async () => {
		const stats = await readClassifierStats(
			store,
			account.accountConfigId,
			"2026-11-01T00:00:00",
		);

		assert.equal(stats.ok, false);
	});
});
