import type {
	DescribeMessageResponse,
	EnvelopeAddressResponse,
	MessageCategory,
} from "@remit/api-openapi-types";

/**
 * UI view model: the canonical generated DescribeMessageResponse plus a couple
 * of render-only fields. Real body bytes arrive via BodyPartResponse.contentUrl
 * (CloudFront, JWT at the edge); for a backendless workbench we carry an inline
 * snippet + rendered HTML so the reading pane shows something real.
 */
export interface MessageView extends DescribeMessageResponse {
	/** One-line preview shown in the message list. */
	preview: string;
	/** Pre-rendered HTML body for the reading pane (stand-in for contentUrl). */
	bodyHtml: string;
}

const inboxId = "mbx_inbox";

function addr(
	displayName: string,
	email: string,
	role: EnvelopeAddressResponse["addressRole"],
	order = 0,
): EnvelopeAddressResponse {
	return {
		addressId: `addr_${email}`,
		displayName,
		normalizedEmail: email,
		addressRole: role,
		addressOrder: order,
	};
}

const me = addr("Alice Tan", "alice@fastmail.example", "to");

interface Seed {
	id: string;
	subject: string;
	fromName: string;
	fromEmail: string;
	date: number;
	preview: string;
	bodyHtml: string;
	category: MessageCategory;
	flagged?: boolean;
	read?: boolean;
}

const seeds: Seed[] = [
	{
		id: "msg_q3",
		subject: "Q3 roadmap review — agenda + pre-read",
		fromName: "Priya Natarajan",
		fromEmail: "priya@northwind.example",
		date: Date.UTC(2026, 4, 29, 8, 52),
		category: "personal",
		flagged: true,
		preview:
			"Sharing the agenda ahead of Thursday. Two open questions on the billing migration I'd like your read on before we lock scope.",
		bodyHtml: `<p>Hi Alice,</p>
<p>Sharing the agenda ahead of Thursday's roadmap review. Two open questions on the billing migration I'd like your read on before we lock scope:</p>
<ol><li>Do we keep the legacy export path through Q4, or cut it at GA?</li><li>Who owns the dunning emails once self-serve ships?</li></ol>
<p>Pre-read is in the deck (slides 4–9). 20 min should cover it.</p>
<p>Thanks,<br/>Priya</p>`,
	},
	{
		id: "msg_deploy",
		subject: "[remit] Deploy to prod succeeded",
		fromName: "Remit CI",
		fromEmail: "ci@remit.example",
		date: Date.UTC(2026, 4, 29, 8, 7),
		category: "automated",
		read: false,
		preview:
			"Pipeline #4821 finished in 6m 12s. 3 stacks updated, 0 drift. View the run for the cdk diff.",
		bodyHtml: `<p><strong>Deploy succeeded</strong> — pipeline <code>#4821</code></p>
<ul><li>Duration: 6m 12s</li><li>Stacks updated: 3</li><li>Drift detected: 0</li></ul>
<p><a href="#">View the run →</a></p>`,
	},
	{
		id: "msg_invoice",
		subject: "Your receipt from Linear",
		fromName: "Linear",
		fromEmail: "billing@linear.example",
		date: Date.UTC(2026, 4, 29, 6, 40),
		category: "transactional",
		read: true,
		preview:
			"Receipt #LIN-20260529 · $80.00 charged to Visa •••• 4242. Thanks for your business.",
		bodyHtml: `<p>Receipt <strong>#LIN-20260529</strong></p>
<p>$80.00 charged to Visa •••• 4242 on May 29, 2026.</p>
<p>Workspace: northwind · Seats: 10</p>`,
	},
	{
		id: "msg_news",
		subject: "The Pragmatic Engineer — Platform teams that scale",
		fromName: "The Pragmatic Engineer",
		fromEmail: "newsletter@pragmaticengineer.example",
		date: Date.UTC(2026, 4, 28, 18, 11),
		category: "newsletter",
		read: true,
		preview:
			"This week: how three companies structured their platform org, the build-vs-buy line for internal tooling, and a reader Q&A.",
		bodyHtml: `<h2>Platform teams that scale</h2>
<p>This week we look at how three companies structured their platform org, where they drew the build-vs-buy line for internal tooling, and a reader Q&amp;A on on-call.</p>
<p><em>Estimated read: 11 min</em></p>`,
	},
	{
		id: "msg_design",
		subject: "Re: Reading pane density — a vote for calmer",
		fromName: "Marcus Webb",
		fromEmail: "marcus@northwind.example",
		date: Date.UTC(2026, 4, 28, 15, 33),
		category: "personal",
		read: true,
		flagged: false,
		preview:
			"Strong +1 on tightening the list rows but keeping the reading pane airy. Gmail fatigue is real. Mocked two options, see attached.",
		bodyHtml: `<p>Strong +1 on tightening the list rows but keeping the reading pane airy — Gmail fatigue is real.</p>
<p>I mocked two options:</p>
<ul><li><strong>A</strong>: 13px list / 15px body, hairline dividers only</li><li><strong>B</strong>: same type, zebra rows</li></ul>
<p>I lean A. Screenshots attached.</p>
<p>— M</p>`,
	},
	{
		id: "msg_security",
		subject: "New sign-in to your account",
		fromName: "Northwind Security",
		fromEmail: "no-reply@accounts.northwind.example",
		date: Date.UTC(2026, 4, 28, 9, 2),
		category: "automated",
		read: true,
		preview:
			"We noticed a new sign-in from Amsterdam, NL on a Mac. If this was you, no action is needed.",
		bodyHtml: `<p>We noticed a new sign-in to your account.</p>
<p><strong>Amsterdam, NL</strong> · macOS · May 28, 2026 at 11:02</p>
<p>If this was you, no action is needed.</p>`,
	},
	{
		id: "msg_offsite",
		subject: "Offsite logistics — rooms, travel, the dinner",
		fromName: "Dana Okafor",
		fromEmail: "dana@northwind.example",
		date: Date.UTC(2026, 4, 27, 16, 48),
		category: "personal",
		read: true,
		preview:
			"Final headcount is 14. I've held rooms at the Conservatorium through Friday — confirm yours by EOD Wed or they release.",
		bodyHtml: `<p>Final headcount is 14.</p>
<p>I've held rooms at the Conservatorium through Friday — confirm yours by EOD Wednesday or they release them.</p>
<p>Dinner Thursday is booked for 19:30. Dietary notes go in the sheet.</p>`,
	},
	{
		id: "msg_social",
		subject: "Sven and 3 others mentioned you",
		fromName: "Mastodon",
		fromEmail: "notifications@social.example",
		date: Date.UTC(2026, 4, 27, 11, 20),
		category: "social",
		read: true,
		preview:
			"You have 4 new mentions and 12 reactions on your thread about serverless email.",
		bodyHtml: `<p>You have <strong>4 new mentions</strong> and 12 reactions on your thread about serverless email.</p>`,
	},
];

let uid = 5000;

function buildMessage(seed: Seed): MessageView {
	const flags: string[] = [];
	if (seed.read) flags.push("\\Seen");
	if (seed.flagged) flags.push("\\Flagged");
	uid += 1;

	return {
		message: {
			messageId: seed.id,
			mailboxId: inboxId,
			uid,
			rfc822Size: seed.bodyHtml.length + 2048,
			internalDate: seed.date / 1000,
			messageIdHeader: `<${seed.id}@northwind.example>`,
		},
		envelope: {
			messageId: seed.id,
			date: seed.date / 1000,
			subject: seed.subject,
			messageIdValue: `${seed.id}@northwind.example`,
			from: [addr(seed.fromName, seed.fromEmail, "from")],
			to: [me],
			cc: [],
			bcc: [],
			replyTo: [],
			category: seed.category,
			senderTrust: seed.category === "personal" ? "wellknown" : "unknown",
		},
		flags,
		bodyParts: [
			{
				bodyPartId: `${seed.id}_p1`,
				mediaType: "TEXT",
				mediaSubtype: "HTML",
				sizeOctets: seed.bodyHtml.length,
				isMultipart: false,
				contentUrl: `/content/accounts/cfg/acc/messages/${seed.id}/parts/1`,
			},
		],
		references: [],
		preview: seed.preview,
		bodyHtml: seed.bodyHtml,
	};
}

export const messages: MessageView[] = seeds.map(buildMessage);

export function messageById(id: string): MessageView | undefined {
	return messages.find((m) => m.message.messageId === id);
}
