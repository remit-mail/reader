import type {
	RemitImapAccountResponse,
	RemitImapCanonicalMailboxRole,
	RemitImapMailboxResponse,
	RemitImapMessageCategory,
	RemitImapOutboxMessageResponse,
	RemitImapOutboxMessageStatus,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	makeAccount,
	makeMailbox,
	makeThreadMessage,
} from "@/test-support/fixtures";

export interface MailWorld {
	accounts: RemitImapAccountResponse[];
	mailboxes: RemitImapMailboxResponse[];
	threads: RemitImapThreadMessageResponse[];
	outbox: RemitImapOutboxMessageResponse[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.now();

const ROLES = [
	"Inbox",
	"Drafts",
	"Sent",
	"Archive",
	"Junk",
	"Trash",
] as const satisfies readonly RemitImapCanonicalMailboxRole[];

const FOLDER_PATHS: Record<(typeof ROLES)[number], string> = {
	Inbox: "INBOX",
	Drafts: "Drafts",
	Sent: "Sent",
	Archive: "Archive",
	Junk: "Junk",
	Trash: "Trash",
};

export const mailboxIdFor = (
	accountId: string,
	role: RemitImapCanonicalMailboxRole,
): string => `mbx-${accountId}-${role.toLowerCase()}`;

const accountWithFolders = (
	accountId: string,
	email: string,
	displayName: string,
): RemitImapAccountResponse =>
	makeAccount({
		accountId,
		email,
		username: email,
		smtpUsername: email,
		displayName,
		lastSyncAt: NOW,
		folderAppointments: ROLES.map((role) => ({
			role,
			source: "Appointed",
			mailboxId: mailboxIdFor(accountId, role),
		})),
	});

const foldersOf = (accountId: string): RemitImapMailboxResponse[] =>
	ROLES.map((role) =>
		makeMailbox({
			accountId,
			mailboxId: mailboxIdFor(accountId, role),
			fullPath: FOLDER_PATHS[role],
			specialUse: role === "Inbox" ? undefined : [role],
		}),
	);

export const PERSONAL = "acc-personal";
export const WORK = "acc-work";

const accounts = [
	accountWithFolders(PERSONAL, "alice@example.com", "Personal"),
	accountWithFolders(WORK, "alice@acme.example", "Work"),
];

interface ThreadSeed {
	id: string;
	accountId: string;
	role?: RemitImapCanonicalMailboxRole;
	fromName: string;
	fromEmail: string;
	subject: string;
	snippet: string;
	category: RemitImapMessageCategory;
	ago: number;
	isRead?: boolean;
	starred?: boolean;
	hasAttachment?: boolean;
}

const thread = (seed: ThreadSeed): RemitImapThreadMessageResponse =>
	makeThreadMessage({
		messageId: `msg-${seed.id}`,
		threadId: `thread-${seed.id}`,
		threadMessageId: `tm-${seed.id}`,
		accountId: seed.accountId,
		mailboxId: mailboxIdFor(seed.accountId, seed.role ?? "Inbox"),
		fromName: seed.fromName,
		fromEmail: seed.fromEmail,
		subject: seed.subject,
		snippet: seed.snippet,
		category: seed.category,
		sentDate: NOW - seed.ago,
		isRead: seed.isRead ?? false,
		hasAttachment: seed.hasAttachment ?? false,
		star: seed.starred ? "yellow" : "none",
		hasStars: seed.starred ?? false,
		syncStatus: "synced",
	});

const inboxThreads: RemitImapThreadMessageResponse[] = [
	thread({
		id: "q3-planning",
		accountId: WORK,
		fromName: "Ada Lovelace",
		fromEmail: "ada@acme.example",
		subject: "Q3 planning",
		snippet: "Can we move the review to Thursday? I have the numbers ready.",
		category: "personal",
		ago: 20 * MINUTE,
		starred: true,
	}),
	thread({
		id: "lease",
		accountId: PERSONAL,
		fromName: "Amara Okafor",
		fromEmail: "amara@example.org",
		subject: "Signed lease attached",
		snippet: "Here is the countersigned copy for your records.",
		category: "personal",
		ago: 2 * HOUR,
		hasAttachment: true,
		starred: true,
	}),
	thread({
		id: "dinner",
		accountId: PERSONAL,
		fromName: "Grace Hopper",
		fromEmail: "grace@example.org",
		subject: "Dinner on Saturday?",
		snippet: "We are thinking the new place on the corner, around seven.",
		category: "personal",
		ago: 5 * HOUR,
		isRead: true,
	}),
	thread({
		id: "invoice",
		accountId: WORK,
		fromName: "Billing",
		fromEmail: "billing@saas.example",
		subject: "Invoice #1042",
		snippet: "Your invoice for September is ready.",
		category: "transactional",
		ago: 7 * HOUR,
		isRead: true,
	}),
	thread({
		id: "shipping",
		accountId: PERSONAL,
		fromName: "Parcel Service",
		fromEmail: "track@parcel.example",
		subject: "Your order has shipped",
		snippet: "Estimated delivery: tomorrow before noon.",
		category: "transactional",
		ago: 9 * HOUR,
	}),
	thread({
		id: "weekly-digest",
		accountId: PERSONAL,
		fromName: "The Weekly",
		fromEmail: "digest@weekly.example",
		subject: "This week in type systems",
		snippet: "Variance, soundness and a long read on gradual typing.",
		category: "newsletter",
		ago: DAY,
	}),
	thread({
		id: "sale",
		accountId: PERSONAL,
		fromName: "Outdoor Store",
		fromEmail: "news@outdoor.example",
		subject: "Autumn sale starts now",
		snippet: "Up to 40% off jackets and boots this weekend only.",
		category: "marketing",
		ago: DAY + 3 * HOUR,
	}),
	thread({
		id: "mention",
		accountId: WORK,
		fromName: "Chat",
		fromEmail: "notifications@chat.example",
		subject: "Linus mentioned you in #design",
		snippet: "Linus: can you take a look at the new header?",
		category: "social",
		ago: DAY + 5 * HOUR,
	}),
	thread({
		id: "build",
		accountId: WORK,
		fromName: "CI",
		fromEmail: "ci@builds.example",
		subject: "Build passed on main",
		snippet: "All 212 checks passed in 6m 12s.",
		category: "automated",
		ago: 2 * DAY,
		isRead: true,
	}),
	thread({
		id: "talk-outline",
		accountId: PERSONAL,
		role: "Archive",
		fromName: "Ken Thompson",
		fromEmail: "ken@example.org",
		subject: "Conference talk outline",
		snippet: "Here is the rough structure for the keynote.",
		category: "personal",
		ago: 3 * DAY,
		isRead: true,
		starred: true,
	}),
];

const serverDrafts: RemitImapThreadMessageResponse[] = [
	thread({
		id: "draft-talk",
		accountId: PERSONAL,
		role: "Drafts",
		fromName: "Alice",
		fromEmail: "alice@example.com",
		subject: "Re: Conference talk outline",
		snippet: "Thanks Ken, I will send slides by Friday.",
		category: "personal",
		ago: 4 * HOUR,
		isRead: true,
	}),
];

interface OutboxSeed {
	id: string;
	accountId: string;
	to: string;
	subject: string;
	body: string;
	status: RemitImapOutboxMessageStatus;
	ago: number;
	lastError?: string;
}

export const outboxMessage = (
	seed: OutboxSeed,
): RemitImapOutboxMessageResponse => {
	const from = accounts.find((account) => account.accountId === seed.accountId);
	return {
		outboxMessageId: `out-${seed.id}`,
		accountId: seed.accountId,
		fromAddress: from?.email ?? "alice@example.com",
		fromName: "Alice",
		toAddresses: [seed.to],
		ccAddresses: [],
		bccAddresses: [],
		subject: seed.subject,
		references: [],
		textBody: seed.body,
		status: seed.status,
		lastError: seed.lastError,
		sentAt: seed.status === "sent" ? NOW - seed.ago : undefined,
		createdAt: NOW - seed.ago,
		updatedAt: NOW - seed.ago,
		attachments: [],
	};
};

const remitDrafts: RemitImapOutboxMessageResponse[] = [
	outboxMessage({
		id: "draft-q3",
		accountId: PERSONAL,
		to: "ada@acme.example",
		subject: "Re: Q3 planning",
		body: "Thanks, Thursday works for me.",
		status: "draft",
		ago: 10 * MINUTE,
	}),
	outboxMessage({
		id: "draft-untitled",
		accountId: PERSONAL,
		to: "team@example.com",
		subject: "",
		body: "",
		status: "draft",
		ago: HOUR,
	}),
];

export const outboxInEveryStatus: RemitImapOutboxMessageResponse[] = [
	outboxMessage({
		id: "queued",
		accountId: WORK,
		to: "ada@acme.example",
		subject: "Re: Q3 planning",
		body: "Thursday it is.",
		status: "queued",
		ago: 2 * MINUTE,
	}),
	outboxMessage({
		id: "sending",
		accountId: WORK,
		to: "team@acme.example",
		subject: "Weekly update",
		body: "Highlights from this week.",
		status: "sending",
		ago: 3 * MINUTE,
	}),
	outboxMessage({
		id: "sent",
		accountId: WORK,
		to: "grace@example.org",
		subject: "Invoice #1042",
		body: "Paid, thanks.",
		status: "sent",
		ago: 16 * MINUTE,
	}),
	outboxMessage({
		id: "unfiled",
		accountId: PERSONAL,
		to: "amara@example.org",
		subject: "Signed lease",
		body: "Signed and attached.",
		status: "unfiled",
		ago: 22 * MINUTE,
		lastError: "Sent, but not filed: this account has no Sent folder",
	}),
	outboxMessage({
		id: "failed",
		accountId: WORK,
		to: "linus@example.org",
		subject: "Design review notes",
		body: "Notes from today.",
		status: "failed",
		ago: 34 * MINUTE,
		lastError: "SMTP connection timed out",
	}),
	outboxMessage({
		id: "blocked",
		accountId: PERSONAL,
		to: "ken@example.org",
		subject: "Re: contract",
		body: "Looks good to me.",
		status: "blocked",
		ago: DAY,
		lastError: "No SMTP server configured for this account",
	}),
];

export const mailWorld = (overrides: Partial<MailWorld> = {}): MailWorld => ({
	accounts,
	mailboxes: accounts.flatMap((account) => foldersOf(account.accountId)),
	threads: [...inboxThreads, ...serverDrafts],
	outbox: [...remitDrafts, ...outboxInEveryStatus],
	...overrides,
});
