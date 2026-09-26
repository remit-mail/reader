import type {
	RemitImapOutboxMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	DAY,
	HOUR,
	type MailWorld,
	MINUTE,
	mailboxIdFor,
	mailWorld,
	outboxMessage,
	threadRow,
	WORK,
} from "./mail-world";

export const INBOX = mailboxIdFor(WORK, "Inbox");

export const LUNCH_SUBJECT = "Lunch Thursday?";
export const LUNCH_BODY = "Are we still on for Thursday? I can do 12:30.";
export const LONG_SUBJECT = "Billing migration owners";
export const TURNS_SUBJECT = "Offsite venue";
export const SCANS_SUBJECT = "Scans";
export const MISSPELT_DRAFT =
	"<p>Ths report is redy today, and the notes are attachd.</p>";
export const PLAIN_DRAFT = [
	"Thanks, that works for me.",
	"",
	"| Region | Total |",
	"| --- | --- |",
	"| EMEA | 412 |",
].join("\n");

const longBody = [
	"Longer context, so the pane has more message than it has room for.",
	...Array.from(
		{ length: 14 },
		(_, index) =>
			`Point ${index + 1}. The billing migration touches the export path, the dunning schedule and the invoice numbering, and each of those has a different owner today.`,
	),
].join("\n\n");

const longDraft = [
	"<p>That works. Before Thursday, three things I want written down:</p>",
	...Array.from(
		{ length: 24 },
		(_, index) =>
			`<p>Point ${index + 1}. Whoever owns the dunning mail after self-serve ships also owns the invoice numbering, and today those are two different people on two different rotas.</p>`,
	),
].join("");

const conversations: RemitImapThreadMessageResponse[] = [
	threadRow({
		id: "lunch",
		accountId: WORK,
		fromName: "Ada Lovelace",
		fromEmail: "ada@acme.example",
		subject: LUNCH_SUBJECT,
		snippet: LUNCH_BODY,
		category: "personal",
		ago: 30 * MINUTE,
	}),
	threadRow({
		id: "billing",
		accountId: WORK,
		fromName: "Priya Raman",
		fromEmail: "priya@acme.example",
		subject: LONG_SUBJECT,
		snippet:
			"Longer context, so the pane has more message than it has room for.",
		category: "personal",
		ago: 3 * HOUR,
	}),
	threadRow({
		id: "venue-1",
		inThread: "venue",
		accountId: WORK,
		role: "Archive",
		fromName: "Linus Berg",
		fromEmail: "linus@acme.example",
		subject: TURNS_SUBJECT,
		snippet: "Two options for the offsite: the boathouse or the old mill.",
		category: "personal",
		ago: 3 * DAY,
		isRead: true,
	}),
	threadRow({
		id: "venue-2",
		inThread: "venue",
		accountId: WORK,
		role: "Sent",
		fromName: "Alice Tan",
		fromEmail: "alice.tan@acme.example",
		subject: `Re: ${TURNS_SUBJECT}`,
		snippet: "The boathouse, if it still has the long table.",
		category: "personal",
		ago: 2 * DAY,
		isRead: true,
	}),
	threadRow({
		id: "venue-3",
		inThread: "venue",
		accountId: WORK,
		fromName: "Linus Berg",
		fromEmail: "linus@acme.example",
		subject: `Re: ${TURNS_SUBJECT}`,
		snippet: "It does. Shall I book it for the 14th?",
		category: "personal",
		ago: 4 * HOUR,
	}),
	threadRow({
		id: "scans",
		accountId: WORK,
		fromName: "Office Scanner",
		fromEmail: "scanner@acme.example",
		subject: SCANS_SUBJECT,
		snippet: "",
		category: "automated",
		ago: 5 * HOUR,
		hasAttachment: true,
	}),
];

const drafts: RemitImapOutboxMessageResponse[] = [
	{
		...outboxMessage({
			id: "misspelt",
			accountId: WORK,
			to: "ada@acme.example",
			subject: "Report",
			body: "Ths report is redy today, and the notes are attachd.",
			status: "draft",
			ago: 5 * MINUTE,
		}),
		htmlBody: MISSPELT_DRAFT,
	},
	outboxMessage({
		id: "plain",
		accountId: WORK,
		to: "ada@acme.example",
		subject: "Re: Q3 planning",
		body: PLAIN_DRAFT,
		status: "draft",
		ago: 6 * MINUTE,
	}),
	{
		...outboxMessage({
			id: "long-reply",
			accountId: WORK,
			to: "ada@acme.example",
			subject: `Re: ${LUNCH_SUBJECT}`,
			body: "That works.",
			status: "draft",
			ago: 7 * MINUTE,
		}),
		htmlBody: longDraft,
	},
];

export const composeWorld = (overrides: Partial<MailWorld> = {}): MailWorld => {
	const base = mailWorld();
	return {
		...base,
		accounts: base.accounts.map((account) =>
			account.accountId === WORK
				? { ...account, composeLanguages: ["en", "nl", "de"] }
				: account,
		),
		threads: [...base.threads, ...conversations],
		outbox: [...base.outbox, ...drafts],
		bodies: { "msg-billing": longBody },
		...overrides,
	};
};

export const withoutSmtp = (world: MailWorld): MailWorld => ({
	...world,
	accounts: world.accounts.map((account) => ({
		...account,
		smtpEnabled: false,
	})),
});

export const messageUrl = (id: string, mailboxId: string = INBOX): string =>
	`/mail/${mailboxId}/thread-${id}/msg-${id}`;

export const threadUrl = (
	threadId: string,
	messageId: string,
	mailboxId: string = INBOX,
): string => `/mail/${mailboxId}/thread-${threadId}/msg-${messageId}`;
