import type {
	AccountDetailOperationsUpdateAccountResponse,
	AddressDetailOperationsUpdateAddressResponse,
	AddressOperationsSearchAddressesResponse,
	CalendarEventOperationsListCalendarEventsResponse,
	CalendarOperationsListCalendarsResponse,
	CalendarSuggestionOperationsListCalendarSuggestionsResponse,
	FilterOperationsListFiltersResponse,
	LabelOperationsListLabelsResponse,
	MailboxDetailOperationsRenameMailboxResponse,
	MailboxOperationsListMailboxesResponse,
	MeOperationsListQuarantineResponse,
	MeOperationsListVipSuggestionsResponse,
	MessageBulkOperationsDeleteMessagesData,
	MessageBulkOperationsDeleteMessagesResponse,
	MessageBulkOperationsMoveMessagesData,
	MessageBulkOperationsMoveMessagesResponse,
	MessageBulkOperationsUpdateFlagsResponse,
	MessageCalendarSuggestionOperationsListMessageCalendarSuggestionsResponse,
	OrganizeOperationsPreviewOrganizeResponse,
	OutboxOperationsListOutboxMessagesResponse,
	RemitImapAddressResponse,
	RemitImapConfigDescriptionResponse,
	RemitImapCreateOutboxMessageInput,
	RemitImapDescribeMessageResponse,
	RemitImapOutboxMessageResponse,
	RemitImapThreadMessageResponse,
	RemitImapThreadSearchResponse,
	RemitImapUpdateOutboxMessageInput,
	SemanticSearchOperationsSemanticSearchResponse,
	SyncOperationsGetSyncStatusResponse,
	SyncOperationsTriggerSyncResponse,
	SystemOperationsGetSystemUpdateResponse,
	ThreadDetailOperationsListThreadMessagesResponse,
	ThreadOperationsListThreadsResponse,
} from "@remit/api-http-client/types.gen.ts";
import { type HttpHandler, HttpResponse, http } from "msw";
import { makeConfig } from "@/test-support/fixtures";
import type { MailWorld } from "./mail-world";

const API = "/api";

export interface MailHandlerOptions {
	withholdCounts?: boolean;
	pageSize?: number;
	holdLaterPages?: boolean;
	draftSave?: "saves" | "refused";
	send?: "sends" | "holds";
	search?: "answers" | "holds";
	config?: "answers" | "holds";
}

const contentPath = (row: RemitImapThreadMessageResponse): string =>
	`/content/accounts/${row.accountConfigId}/${row.accountId}/messages/${row.messageId}/parts/1`;

const attachmentOnly = (row: RemitImapThreadMessageResponse): boolean =>
	row.hasAttachment && !row.snippet;

const bodyPartsOf = (
	row: RemitImapThreadMessageResponse,
): RemitImapDescribeMessageResponse["bodyParts"] =>
	attachmentOnly(row)
		? [
				{
					bodyPartId: `part-${row.messageId}`,
					mediaType: "APPLICATION",
					mediaSubtype: "pdf",
					sizeOctets: 48_000,
					isMultipart: false,
					disposition: "attachment",
					dispositionFilename: "scan.pdf",
					contentUrl: contentPath(row),
				},
			]
		: [
				{
					bodyPartId: `part-${row.messageId}`,
					mediaType: "TEXT",
					mediaSubtype: "plain",
					sizeOctets: (row.snippet ?? "").length,
					isMultipart: false,
					contentUrl: contentPath(row),
				},
			];

const describe = (
	row: RemitImapThreadMessageResponse,
): RemitImapDescribeMessageResponse => ({
	message: {
		messageId: row.messageId,
		mailboxId: row.mailboxId,
		uid: 1,
		rfc822Size: 2048,
		internalDate: row.sentDate,
		status: row.status,
		syncStatus: row.syncStatus,
		abandonedMutation: row.abandonedMutation,
	},
	envelope: {
		messageId: row.messageId,
		date: row.sentDate,
		subject: row.subject,
		from: [
			{
				addressId: `addr-${row.messageId}`,
				displayName: row.fromName,
				normalizedEmail: row.fromEmail ?? "",
				addressRole: "from",
				addressOrder: 0,
			},
		],
		to: [],
		cc: [],
		bcc: [],
		replyTo: [],
		category: row.category,
		senderTrust: row.senderTrust,
	},
	flags: row.isRead ? ["\\Seen"] : [],
	bodyParts: bodyPartsOf(row),
	references: [],
});

const matchesText = (
	row: RemitImapThreadMessageResponse,
	needle: string,
	fields: (keyof RemitImapThreadMessageResponse)[],
): boolean => {
	const lowered = needle.toLowerCase();
	return fields.some((field) =>
		String(row[field] ?? "")
			.toLowerCase()
			.includes(lowered),
	);
};

const narrow = (
	rows: RemitImapThreadMessageResponse[],
	params: URLSearchParams,
): RemitImapThreadMessageResponse[] => {
	const categories = params.getAll("category");
	const query = params.get("query");
	const from = params.get("from");
	const subject = params.get("subject");
	const accountId = params.get("accountId");
	const mailboxId = params.get("mailboxId");
	return rows.filter((row) => {
		if (params.get("starred") === "true" && !row.hasStars) return false;
		if (params.get("unread") === "true" && row.isRead) return false;
		if (params.get("attachments") === "true" && !row.hasAttachment)
			return false;
		if (categories.length > 0 && !categories.includes(row.category))
			return false;
		if (accountId && row.accountId !== accountId) return false;
		if (mailboxId && row.mailboxId !== mailboxId) return false;
		if (query && !matchesText(row, query, ["subject", "fromName", "snippet"]))
			return false;
		if (from && !matchesText(row, from, ["fromName", "fromEmail"]))
			return false;
		if (subject && !matchesText(row, subject, ["subject"])) return false;
		return true;
	});
};

const newestFirst = (
	rows: RemitImapThreadMessageResponse[],
): RemitImapThreadMessageResponse[] =>
	[...rows].sort((a, b) => b.sentDate - a.sentDate);

const listing = (
	rows: RemitImapThreadMessageResponse[],
	params: URLSearchParams,
	options: MailHandlerOptions,
): RemitImapThreadSearchResponse => {
	const offset = Number(params.get("continuationToken") ?? 0);
	const size = options.pageSize ?? Number(params.get("limit") ?? rows.length);
	const next = offset + size;
	const counted = params.get("count") === "true" && !options.withholdCounts;
	return {
		items:
			params.get("results") === "false"
				? []
				: newestFirst(rows).slice(offset, next),
		continuationToken:
			options.pageSize !== undefined && next < rows.length
				? String(next)
				: undefined,
		count: counted ? new Set(rows.map((row) => row.threadId)).size : undefined,
	};
};

const pending = (): Promise<never> => new Promise<never>(() => undefined);

export const mailHandlers = (
	world: MailWorld,
	options: MailHandlerOptions = {},
): HttpHandler[] => {
	const byMessageId = new Map(world.threads.map((row) => [row.messageId, row]));
	const inboxIds = new Set(
		world.accounts.flatMap((account) =>
			account.folderAppointments
				.filter((appointment) => appointment.role === "Inbox")
				.map((appointment) => appointment.mailboxId),
		),
	);

	const outbox = new Map(
		world.outbox.map((message) => [message.outboxMessageId, message]),
	);
	let draftsCreated = 0;
	const refuseSave = () =>
		HttpResponse.json(
			{ status: 409, message: "The mail server did not accept the draft." },
			{ status: 409 },
		);

	return [
		http.get(`${API}/config`, () =>
			options.config === "holds"
				? pending()
				: HttpResponse.json<RemitImapConfigDescriptionResponse>(
						makeConfig(world.accounts),
					),
		),
		http.patch(
			`${API}/accounts/:accountId/mailboxes/:mailboxId`,
			({ params }) => {
				const mailbox = world.mailboxes.find(
					(candidate) => candidate.mailboxId === params.mailboxId,
				);
				if (!mailbox)
					return HttpResponse.json(
						{ status: 404, message: "Mailbox not found" },
						{ status: 404 },
					);
				return HttpResponse.json<MailboxDetailOperationsRenameMailboxResponse>(
					mailbox,
				);
			},
		),
		http.get(`${API}/accounts/:accountId/mailboxes`, ({ params }) =>
			HttpResponse.json<MailboxOperationsListMailboxesResponse>({
				items: world.mailboxes.filter(
					(mailbox) => mailbox.accountId === params.accountId,
				),
			}),
		),
		http.patch(`${API}/accounts/:accountId`, ({ params }) => {
			const account = world.accounts.find(
				(candidate) => candidate.accountId === params.accountId,
			);
			if (!account)
				return HttpResponse.json(
					{ status: 404, message: "Account not found" },
					{ status: 404 },
				);
			return HttpResponse.json<AccountDetailOperationsUpdateAccountResponse>(
				account,
			);
		}),
		http.delete(
			`${API}/accounts/:accountId`,
			() => new HttpResponse(null, { status: 204 }),
		),
		http.get(`${API}/addresses/search`, ({ request }) => {
			const needle = (
				new URL(request.url).searchParams.get("q") ?? ""
			).toLowerCase();
			return HttpResponse.json<AddressOperationsSearchAddressesResponse>({
				items: world.addresses.filter(
					(address) =>
						address.normalizedEmail.includes(needle) ||
						(address.displayName ?? "").toLowerCase().includes(needle),
				),
			});
		}),
		http.patch(`${API}/addresses/:addressId`, ({ params }) => {
			const address = world.addresses.find(
				(candidate) => candidate.addressId === params.addressId,
			);
			if (!address)
				return HttpResponse.json(
					{ status: 404, message: "Address not found" },
					{ status: 404 },
				);
			return HttpResponse.json<AddressDetailOperationsUpdateAddressResponse>(
				address,
			);
		}),
		http.get(`${API}/accounts/:accountId/sync/status`, ({ params }) =>
			HttpResponse.json<SyncOperationsGetSyncStatusResponse>({
				accountId: String(params.accountId),
				syncPhase: "complete",
				mailboxes: [],
			}),
		),
		http.get(`${API}/accounts/:accountId/labels`, () =>
			HttpResponse.json<LabelOperationsListLabelsResponse>({ items: [] }),
		),
		http.get(`${API}/accounts/:accountId/filters`, () =>
			HttpResponse.json<FilterOperationsListFiltersResponse>({ items: [] }),
		),
		http.post(`${API}/accounts/:accountId/sync`, () =>
			HttpResponse.json<SyncOperationsTriggerSyncResponse>({
				triggered: false,
				message: "Already up to date",
			}),
		),
		http.get(`${API}/messages/:messageId/calendar-suggestions`, () =>
			HttpResponse.json<MessageCalendarSuggestionOperationsListMessageCalendarSuggestionsResponse>(
				{ items: [] },
			),
		),
		http.get(`${API}/messages/:messageId`, ({ params }) => {
			const row = byMessageId.get(String(params.messageId));
			if (!row)
				return HttpResponse.json(
					{ status: 404, message: "Message not found" },
					{ status: 404 },
				);
			return HttpResponse.json<RemitImapDescribeMessageResponse>(describe(row));
		}),
		http.post(`${API}/messages/flags`, () =>
			HttpResponse.json<MessageBulkOperationsUpdateFlagsResponse>({
				successCount: 1,
				failureCount: 0,
			}),
		),
		http.post(`${API}/messages/delete`, async ({ request }) => {
			const { messageIds } =
				(await request.json()) as MessageBulkOperationsDeleteMessagesData["body"];
			return HttpResponse.json<MessageBulkOperationsDeleteMessagesResponse>({
				successCount: messageIds.length,
				failureCount: 0,
			});
		}),
		http.post(`${API}/messages/move`, async ({ request }) => {
			const { messageIds } =
				(await request.json()) as MessageBulkOperationsMoveMessagesData["body"];
			return HttpResponse.json<MessageBulkOperationsMoveMessagesResponse>({
				successCount: messageIds.length,
				failureCount: 0,
			});
		}),
		http.post(`${API}/accounts/:accountId/organize/preview`, ({ params }) => {
			const matched = world.threads.filter(
				(row) => row.accountId === params.accountId,
			);
			return HttpResponse.json<OrganizeOperationsPreviewOrganizeResponse>({
				matchedCount: matched.length,
				messageIds: matched.map((row) => row.messageId),
			});
		}),
		http.get(
			"/content/accounts/:accountConfigId/:accountId/messages/:messageId/parts/*",
			({ params }) =>
				HttpResponse.text(
					world.bodies[String(params.messageId)] ??
						byMessageId.get(String(params.messageId))?.snippet ??
						"",
				),
		),
		http.get(`${API}/threads/:threadId/messages`, ({ params }) =>
			HttpResponse.json<ThreadDetailOperationsListThreadMessagesResponse>({
				items: world.threads.filter((row) => row.threadId === params.threadId),
			}),
		),
		http.get(`${API}/threads`, ({ request }) => {
			const params = new URL(request.url).searchParams;
			const searching = params.has("query");
			const scope = world.threads.filter(
				(row) =>
					searching ||
					params.get("starred") === "true" ||
					inboxIds.has(row.mailboxId),
			);
			if (options.holdLaterPages && params.has("continuationToken"))
				return pending();
			if (searching && options.search === "holds") return pending();
			return HttpResponse.json(listing(narrow(scope, params), params, options));
		}),
		http.get(
			`${API}/mailboxes/:mailboxId/threads/search`,
			({ request, params }) => {
				const search = new URL(request.url).searchParams;
				if (search.has("query") && options.search === "holds") return pending();
				return HttpResponse.json(
					listing(
						narrow(
							world.threads.filter((row) => row.mailboxId === params.mailboxId),
							search,
						),
						search,
						options,
					),
				);
			},
		),
		http.get(`${API}/mailboxes/:mailboxId/threads`, ({ params }) =>
			HttpResponse.json<ThreadOperationsListThreadsResponse>({
				items: newestFirst(
					world.threads.filter((row) => row.mailboxId === params.mailboxId),
				),
			}),
		),
		http.get(`${API}/outbox`, () =>
			HttpResponse.json<OutboxOperationsListOutboxMessagesResponse>({
				items: [...outbox.values()],
			}),
		),
		http.post(`${API}/outbox`, async ({ request }) => {
			if (options.draftSave === "refused") return refuseSave();
			const input = (await request.json()) as RemitImapCreateOutboxMessageInput;
			draftsCreated += 1;
			const account = world.accounts.find(
				(candidate) => candidate.accountId === input.accountId,
			);
			const created: RemitImapOutboxMessageResponse = {
				outboxMessageId: `out-created-${draftsCreated}`,
				accountId: input.accountId,
				fromAddress: account?.email ?? "",
				fromName: account?.displayName,
				toAddresses: input.toAddresses,
				ccAddresses: input.ccAddresses ?? [],
				bccAddresses: input.bccAddresses ?? [],
				subject: input.subject,
				textBody: input.textBody,
				htmlBody: input.htmlBody,
				references: input.references ?? [],
				status: "draft",
				createdAt: Date.UTC(2026, 8, 24, 13, 0),
				updatedAt: Date.UTC(2026, 8, 24, 13, 0),
				attachments: [],
			};
			outbox.set(created.outboxMessageId, created);
			return HttpResponse.json<RemitImapOutboxMessageResponse>(created);
		}),
		http.get(`${API}/outbox/:outboxMessageId`, ({ params }) => {
			const message = outbox.get(String(params.outboxMessageId));
			if (!message)
				return HttpResponse.json(
					{ status: 404, message: "Outbox message not found" },
					{ status: 404 },
				);
			return HttpResponse.json<RemitImapOutboxMessageResponse>(message);
		}),
		http.patch(
			`${API}/outbox/:outboxMessageId`,
			async ({ params, request }) => {
				if (options.draftSave === "refused") return refuseSave();
				const id = String(params.outboxMessageId);
				const current = outbox.get(id);
				if (!current)
					return HttpResponse.json(
						{ status: 404, message: "Outbox message not found" },
						{ status: 404 },
					);
				const input =
					(await request.json()) as RemitImapUpdateOutboxMessageInput;
				const { attachmentIds: _attachmentIds, ...fields } = input;
				const updated: RemitImapOutboxMessageResponse = {
					...current,
					...fields,
					status: "draft",
				};
				outbox.set(id, updated);
				return HttpResponse.json<RemitImapOutboxMessageResponse>(updated);
			},
		),
		http.post(`${API}/outbox/:outboxMessageId/send`, ({ params }) => {
			if (options.send === "holds") return pending();
			const id = String(params.outboxMessageId);
			const current = outbox.get(id);
			if (!current)
				return HttpResponse.json(
					{ status: 404, message: "Outbox message not found" },
					{ status: 404 },
				);
			const queued: RemitImapOutboxMessageResponse = {
				...current,
				status: "queued",
			};
			outbox.set(id, queued);
			return HttpResponse.json<RemitImapOutboxMessageResponse>(queued);
		}),
		http.delete(`${API}/outbox/:outboxMessageId`, ({ params }) => {
			outbox.delete(String(params.outboxMessageId));
			return new HttpResponse(null, { status: 204 });
		}),
		http.get(`${API}/calendars`, () =>
			HttpResponse.json<CalendarOperationsListCalendarsResponse>({ items: [] }),
		),
		http.get(`${API}/calendar-events`, () =>
			HttpResponse.json<CalendarEventOperationsListCalendarEventsResponse>({
				items: [],
			}),
		),
		http.get(`${API}/calendar-suggestions`, () =>
			HttpResponse.json<CalendarSuggestionOperationsListCalendarSuggestionsResponse>(
				{ items: [] },
			),
		),
		http.get(`${API}/search/semantic`, () =>
			options.search === "holds"
				? pending()
				: HttpResponse.json<SemanticSearchOperationsSemanticSearchResponse>({
						items: [],
					}),
		),
		http.get(`${API}/me/quarantine`, () =>
			HttpResponse.json<MeOperationsListQuarantineResponse>({
				entries: world.quarantine,
			}),
		),
		http.get(`${API}/me/vip-suggestions`, () =>
			HttpResponse.json<MeOperationsListVipSuggestionsResponse>({
				suggestions: world.vipSuggestions,
			}),
		),
		http.get(`${API}/system/update`, () =>
			HttpResponse.json<SystemOperationsGetSystemUpdateResponse>(
				world.systemUpdate,
			),
		),
		http.all(`${API}/*`, ({ request }) =>
			HttpResponse.json(
				{
					status: 501,
					message: `No story handler for ${request.method} ${new URL(request.url).pathname}`,
				},
				{ status: 501 },
			),
		),
	];
};
