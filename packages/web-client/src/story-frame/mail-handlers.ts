import type {
	FilterOperationsListFiltersResponse,
	LabelOperationsListLabelsResponse,
	MailboxOperationsListMailboxesResponse,
	MeOperationsListQuarantineResponse,
	MeOperationsListVipSuggestionsResponse,
	OutboxOperationsListOutboxMessagesResponse,
	RemitImapConfigDescriptionResponse,
	RemitImapThreadMessageResponse,
	RemitImapThreadSearchResponse,
	SyncOperationsGetSyncStatusResponse,
	SystemOperationsGetSystemUpdateResponse,
	ThreadDetailOperationsListThreadMessagesResponse,
	ThreadOperationsListThreadsResponse,
} from "@remit/api-http-client/types.gen.ts";
import { type HttpHandler, HttpResponse, http } from "msw";
import { makeConfig } from "@/test-support/fixtures";
import type { MailWorld } from "./mail-world";

const API = "/api";

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
): RemitImapThreadSearchResponse => {
	const limit = Number(params.get("limit") ?? rows.length);
	return {
		items:
			params.get("results") === "false"
				? []
				: newestFirst(rows).slice(0, limit),
		count:
			params.get("count") === "true"
				? new Set(rows.map((row) => row.threadId)).size
				: undefined,
	};
};

export const mailHandlers = (world: MailWorld): HttpHandler[] => {
	const inboxIds = new Set(
		world.accounts.flatMap((account) =>
			account.folderAppointments
				.filter((appointment) => appointment.role === "Inbox")
				.map((appointment) => appointment.mailboxId),
		),
	);

	return [
		http.get(`${API}/config`, () =>
			HttpResponse.json<RemitImapConfigDescriptionResponse>(
				makeConfig(world.accounts),
			),
		),
		http.get(`${API}/accounts/:accountId/mailboxes`, ({ params }) =>
			HttpResponse.json<MailboxOperationsListMailboxesResponse>({
				items: world.mailboxes.filter(
					(mailbox) => mailbox.accountId === params.accountId,
				),
			}),
		),
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
			return HttpResponse.json(listing(narrow(scope, params), params));
		}),
		http.get(
			`${API}/mailboxes/:mailboxId/threads/search`,
			({ request, params }) =>
				HttpResponse.json(
					listing(
						narrow(
							world.threads.filter((row) => row.mailboxId === params.mailboxId),
							new URL(request.url).searchParams,
						),
						new URL(request.url).searchParams,
					),
				),
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
				items: world.outbox,
			}),
		),
		http.get(`${API}/me/quarantine`, () =>
			HttpResponse.json<MeOperationsListQuarantineResponse>({ entries: [] }),
		),
		http.get(`${API}/me/vip-suggestions`, () =>
			HttpResponse.json<MeOperationsListVipSuggestionsResponse>({
				suggestions: [],
			}),
		),
		http.get(`${API}/system/update`, () =>
			HttpResponse.json<SystemOperationsGetSystemUpdateResponse>({
				currentVersion: "0.0.0-storybook",
				check: { status: "disabled" },
				run: null,
			}),
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
