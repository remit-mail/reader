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
	FilterItem,
	IAddressRepository,
	ICalendarSuggestionRepository,
	ICalendarUnitOfWork,
	IEnvelopeRepository,
	IFilterRepository,
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

/** DTSTART with neither a Z nor a TZID: RFC 5545 floating time. */
const FLOATING_INVITATION_EML = Buffer.from(
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
		"Content-Type: text/calendar; method=REQUEST",
		"",
		[
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Example Corp//Scheduler//EN",
			"METHOD:REQUEST",
			"BEGIN:VEVENT",
			`UID:${UID}`,
			"DTSTAMP:20260801T090000Z",
			"SEQUENCE:0",
			"DTSTART:20260901T100000",
			"DTEND:20260901T110000",
			"SUMMARY:Quarterly review",
			"ORGANIZER:mailto:organizer@example.test",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n"),
		"--bnd--",
		"",
	].join("\r\n"),
);

/** The shape `dismiss{muteSender:true}` writes: a standing rule, no action. */
const MUTE_RULE = (sender: string): FilterItem =>
	({
		filterId: `mute-${sender}`,
		accountConfigId: "cfg-1",
		name: `Muted invitations from ${sender}`,
		scope: "Standing",
		state: "Active",
		matchOperator: "And",
		literalClauses: [{ field: "From", value: sender }],
		actionLabelId: "None",
		actionMailboxId: "None",
	}) as unknown as FilterItem;

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

	async supersedeIfPending(
		_accountConfigId: string,
		suggestionId: string,
	): Promise<CalendarSuggestionItem | null> {
		const row = this.rows.get(suggestionId);
		if (!row || row.state !== CalendarSuggestionState.Pending) return null;
		const retired = {
			...row,
			state: CalendarSuggestionState.Superseded,
			acceptedCalendarObjectId: "",
		};
		this.rows.set(suggestionId, retired);
		return retired;
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
	mutedSenderFilters = [] as FilterItem[],
}: {
	bodyStorageKey?: string;
	timezone?: string;
	withCalendarConfig?: boolean;
	mutedSenderFilters?: FilterItem[];
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
		findAllByMessageId: async () => [
			{
				threadMessageId: "tm-1",
				sentDate: 1,
				mailboxId: "mb-inbox",
				isRead: false,
				isDeleted: false,
				hasStars: false,
				hasAttachment: false,
			},
		],
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		// The read-miss the forced re-sync rides in on: the row says the body is
		// stored, the object is gone, so the pass re-fetches and re-enters
		// applyPostStoreSteps with `bodyStorageKey` already set.
		retrieve: async () => {
			throw Object.assign(new Error("gone"), { name: "NoSuchKey" });
		},
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

	// The producer provisions the default collection through the unit of work,
	// so this stands in for it — `create` is idempotent on a derived id, which
	// is why the producer may call it on every calendar-carrying message.
	const collections = new Map<string, { timezone: string }>();
	const calendarUnitOfWork = {
		transaction: <T>(
			run: (repos: {
				calendarCollection: {
					create: (input: {
						accountConfigId: string;
					}) => Promise<{ calendarId: string; timezone: string }>;
				};
			}) => Promise<T>,
		) =>
			run({
				calendarCollection: {
					create: async (input: { accountConfigId: string }) => {
						const existing = collections.get(input.accountConfigId);
						if (existing) {
							return { calendarId: "cal-1", timezone: existing.timezone };
						}
						collections.set(input.accountConfigId, { timezone });
						return { calendarId: "cal-1", timezone };
					},
				},
			}),
	} as unknown as ICalendarUnitOfWork;

	const filterService = {
		listByAccountAndState: async () => mutedSenderFilters,
	} as unknown as Pick<IFilterRepository, "listByAccountAndState">;

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
					calendarUnitOfWork,
					filterService,
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

	it("reads a floating start in the collection's own zone", async () => {
		// An invitation whose DTSTART names no zone is RFC 5545 floating time.
		// Read in UTC it lands two hours out for an Amsterdam calendar, and the
		// user is shown the wrong hour with nothing saying so.
		const harness = buildHarness({ timezone: "Europe/Amsterdam" });

		await readBody(harness.service, FLOATING_INVITATION_EML);

		const row = [...harness.suggestions.rows.values()][0];
		assert.equal(row?.dtStart, "2026-09-01T10:00:00+02:00");
		assert.equal(row?.zoneCertainty, "Local");
	});

	it("offers no card for a sender the user muted", async () => {
		// The standing rule `dismiss{muteSender:true}` writes has exactly one
		// reader, and this is it: the index-time filter pipeline skips a rule
		// with no label and no move, so without this the button does nothing.
		const harness = buildHarness({
			mutedSenderFilters: [MUTE_RULE("organizer@example.test")],
		});

		await readBody(harness.service, INVITATION_EML());

		assert.equal(harness.suggestions.rows.size, 0);
	});

	it("still offers a card when the rule names a different sender", async () => {
		const harness = buildHarness({
			mutedSenderFilters: [MUTE_RULE("someone-else@example.test")],
		});

		await readBody(harness.service, INVITATION_EML());

		assert.equal(harness.suggestions.rows.size, 1);
	});

	it("still offers a card when the rule about this sender does something", async () => {
		// A rule that labels or moves this sender's mail is an ordinary filter
		// the pipeline acts on, not the user refusing their invitations.
		const harness = buildHarness({
			mutedSenderFilters: [
				{
					...MUTE_RULE("organizer@example.test"),
					actionLabelId: "label-1",
				} as FilterItem,
			],
		});

		await readBody(harness.service, INVITATION_EML());

		assert.equal(harness.suggestions.rows.size, 1);
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

		const result = await readBody(harness.service, INVITATION_EML());

		// The pass genuinely ran — the body was re-fetched and re-stored — and
		// still offered nothing.
		assert.equal(result.storedAt, "s3://bodies/m-1");
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

		assert.equal(result.storedAt, "newly-stored");
		assert.equal(harness.suggestions.rows.size, 0);
	});

	it("is a no-op when body sync was built without a CalendarSuggestionConfig", async () => {
		const harness = buildHarness({ withCalendarConfig: false });

		await readBody(harness.service, INVITATION_EML());

		assert.equal(harness.suggestions.rows.size, 0);
	});
});
