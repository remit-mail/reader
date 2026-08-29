/**
 * Issue #1033 stage 0.3: an invitation arriving in the mail becomes a card
 * beside the message, never a calendar entry. These drive `BodySyncService`
 * end to end — read-path body materialization into `applyPostStoreSteps` — so
 * the first-seen gate is asserted against the real pass, not a helper.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CalendarSuggestionItem,
	IAddressRepository,
	ICalendarCollectionRepository,
	ICalendarSuggestionRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IThreadMessageRepository,
	PutCalendarSuggestionInput,
	ResultList,
} from "@remit/data-ports";
import { deriveCalendarSuggestionId } from "@remit/data-ports/id";
import {
	CalendarInviteMethod,
	CalendarSuggestionSource,
	CalendarSuggestionState,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { IImapConnection } from "./types.js";

const UID = "invite-4711@example.test";

const VCALENDAR = (sequence: number, method: string): string =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Example Corp//Scheduler//EN",
		`METHOD:${method}`,
		"BEGIN:VEVENT",
		`UID:${UID}`,
		"DTSTAMP:20260801T090000Z",
		`SEQUENCE:${sequence}`,
		"DTSTART:20260901T080000Z",
		"DTEND:20260901T090000Z",
		"SUMMARY:Quarterly review",
		"ORGANIZER:mailto:organizer@example.test",
		"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:user@example.test",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

const INVITATION_EML = (sequence = 0, method = "REQUEST"): Buffer =>
	Buffer.from(
		[
			"From: Organizer <organizer@example.test>",
			"To: user@example.test",
			"Subject: Quarterly review",
			'Content-Type: multipart/alternative; boundary="bnd"',
			"",
			"--bnd",
			"Content-Type: text/plain",
			"",
			"You are invited.",
			"--bnd",
			'Content-Type: text/calendar; method=REQUEST; charset="UTF-8"',
			"",
			VCALENDAR(sequence, method),
			"--bnd--",
			"",
		].join("\r\n"),
	);

const PLAIN_EML = Buffer.from(
	[
		"From: Someone <someone@example.test>",
		"To: user@example.test",
		"Subject: Hello",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

class MemorySuggestions implements ICalendarSuggestionRepository {
	readonly rows = new Map<string, CalendarSuggestionItem>();

	async put(
		input: PutCalendarSuggestionInput,
	): Promise<CalendarSuggestionItem> {
		const suggestionId = deriveCalendarSuggestionId(
			input.messageId,
			input.bodyPartId,
			input.icalUid,
		);
		const existing = this.rows.get(suggestionId);
		const row: CalendarSuggestionItem = {
			...input,
			suggestionId,
			state: existing?.state ?? CalendarSuggestionState.Pending,
			acceptedCalendarObjectId: existing?.acceptedCalendarObjectId ?? "",
			createdAt: existing?.createdAt ?? 1,
			updatedAt: 1,
		};
		this.rows.set(suggestionId, row);
		return row;
	}

	async get(
		_accountConfigId: string,
		suggestionId: string,
	): Promise<CalendarSuggestionItem> {
		const row = this.rows.get(suggestionId);
		if (!row) throw new Error(`missing ${suggestionId}`);
		return row;
	}

	async listByMessage(
		_accountConfigId: string,
		messageId: string,
	): Promise<CalendarSuggestionItem[]> {
		return [...this.rows.values()].filter((row) => row.messageId === messageId);
	}

	async listByState(
		_accountConfigId: string,
		state: CalendarSuggestionItem["state"],
	): Promise<ResultList<CalendarSuggestionItem>> {
		return {
			items: [...this.rows.values()].filter((row) => row.state === state),
			continuationToken: undefined,
		};
	}

	async settle(
		_accountConfigId: string,
		suggestionId: string,
		input: {
			state: CalendarSuggestionItem["state"];
			acceptedCalendarObjectId: string;
		},
	): Promise<CalendarSuggestionItem> {
		const row = this.rows.get(suggestionId);
		if (!row) throw new Error(`missing ${suggestionId}`);
		const settled = { ...row, ...input };
		this.rows.set(suggestionId, settled);
		return settled;
	}
}

interface Harness {
	service: BodySyncService;
	suggestions: MemorySuggestions;
}

const buildHarness = ({
	bodyStorageKey,
	timezone = "",
	withCalendarConfig = true,
}: {
	bodyStorageKey?: string;
	timezone?: string;
	withCalendarConfig?: boolean;
} = {}): Harness => {
	const suggestions = new MemorySuggestions();

	const messageService = {
		get: async (messageId: string) => ({
			messageId,
			mailboxId: "mb-inbox",
			uid: 1,
			bodyStorageKey,
		}),
		update: async () => {},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [],
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		storeMessageBody: async () => ({ uri: "s3://bodies/stored" }),
		storeParsedBody: async () => {},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const addressService = {
		getAddress: async () => ({ flags: {} }),
		incrementInboundCount: async () => {},
	} as unknown as IAddressRepository;

	const envelopeService = {
		listBodyParts: async () => [],
	} as unknown as IEnvelopeRepository;

	const calendarCollectionService = {
		findByUrlSegment: async () => ({ timezone }),
	} as unknown as ICalendarCollectionRepository;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		{ info: () => {}, error: () => {} },
		undefined,
		undefined,
		undefined,
		undefined,
		withCalendarConfig
			? {
					calendarSuggestionService: suggestions,
					calendarCollectionService,
				}
			: undefined,
	);

	return { service, suggestions };
};

const readBody = async (
	service: BodySyncService,
	eml: Buffer,
	messageId = "m-1",
) => {
	const connection = {
		openBox: async () => {},
		fetchMessageBody: async () => eml,
	} as unknown as IImapConnection;
	return service.fetchAndGetBody(
		messageId,
		"acc-1",
		"cfg-1",
		"INBOX",
		async () => connection,
	);
};

describe("mail-derived calendar suggestions (issue #1033)", () => {
	it("offers an invitation as one Pending suggestion", async () => {
		const harness = buildHarness();

		await readBody(harness.service, INVITATION_EML());

		const rows = [...harness.suggestions.rows.values()];
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.state, CalendarSuggestionState.Pending);
		assert.equal(rows[0]?.icalUid, UID);
		assert.equal(rows[0]?.method, CalendarInviteMethod.Request);
		assert.equal(rows[0]?.summary, "Quarterly review");
		assert.equal(rows[0]?.organizer, "organizer@example.test");
		assert.equal(rows[0]?.source, CalendarSuggestionSource.IcalendarPart);
	});

	it("stores the invitation's bytes so accepting can write them unchanged", async () => {
		const harness = buildHarness();

		await readBody(harness.service, INVITATION_EML());

		const row = [...harness.suggestions.rows.values()][0];
		assert.match(row?.icalData ?? "", /BEGIN:VCALENDAR/);
		assert.match(row?.icalData ?? "", /UID:invite-4711@example\.test/);
	});

	it("offers nothing for a message carrying no calendar part", async () => {
		const harness = buildHarness();

		await readBody(harness.service, PLAIN_EML);

		assert.equal(harness.suggestions.rows.size, 0);
	});

	it("offers nothing on a forced body re-sync", async () => {
		// The owner's ruling on #497/#1011: a card is offered at first sight,
		// the same moment the account's filters run. A forced re-sync re-enters
		// this pass with the body already stored, and re-offering there would
		// resurrect a card the user dismissed.
		const harness = buildHarness({ bodyStorageKey: "s3://bodies/m-1" });

		await readBody(harness.service, INVITATION_EML());

		assert.equal(harness.suggestions.rows.size, 0);
	});

	it("supersedes the earlier revision when a higher SEQUENCE arrives", async () => {
		const harness = buildHarness();

		await readBody(harness.service, INVITATION_EML(0), "m-1");
		await readBody(harness.service, INVITATION_EML(1), "m-2");

		const rows = [...harness.suggestions.rows.values()];
		assert.equal(rows.length, 2);
		assert.deepEqual(
			rows.map((row) => `${row.messageId}:${row.state}`).sort(),
			["m-1:Superseded", "m-2:Pending"],
		);
	});

	it("offers a cancellation as its own card, writing no calendar object", async () => {
		const harness = buildHarness();

		await readBody(harness.service, INVITATION_EML(1, "CANCEL"));

		const row = [...harness.suggestions.rows.values()][0];
		assert.equal(row?.method, CalendarInviteMethod.Cancel);
		assert.equal(row?.state, CalendarSuggestionState.Pending);
		assert.equal(row?.acceptedCalendarObjectId, "");
	});

	it("stores the body even when the message carries unreadable iCalendar", async () => {
		const harness = buildHarness();
		const broken = Buffer.from(
			[
				"From: Organizer <organizer@example.test>",
				"To: user@example.test",
				"Subject: Broken",
				'Content-Type: multipart/alternative; boundary="bnd"',
				"",
				"--bnd",
				"Content-Type: text/plain",
				"",
				"hi",
				"--bnd",
				"Content-Type: text/calendar",
				"",
				"BEGIN:VCALENDAR",
				"--bnd--",
				"",
			].join("\r\n"),
		);

		const result = await readBody(harness.service, broken);

		assert.equal(result.storedAt, "s3://bodies/stored");
		assert.equal(harness.suggestions.rows.size, 0);
	});

	it("is a no-op when body sync was built without a CalendarSuggestionConfig", async () => {
		const harness = buildHarness({ withCalendarConfig: false });

		await readBody(harness.service, INVITATION_EML());

		assert.equal(harness.suggestions.rows.size, 0);
	});
});
