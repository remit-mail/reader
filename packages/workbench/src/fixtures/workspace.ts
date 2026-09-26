import type {
	IntelligenceData,
	NavAccount,
	ThreadData,
	ThreadRowData,
} from "@remit/ui";

/**
 * Multi-account workbench fixtures: three accounts (personal gmail-ish,
 * work, a muted hobby account), ~25 threads with realistic senders and
 * timestamps relative to a fixed "today", plus the thread and intelligence
 * data for the reading pane.
 */

/** Fixed "now" so relative labels are deterministic: Wed Jun 10 2026, 09:30. */
const NOW = Date.UTC(2026, 5, 10, 9, 30);

function ago(hours: number): number {
	return NOW - hours * 3_600_000;
}

function timeLabel(epochMs: number): string {
	const d = new Date(epochMs);
	const now = new Date(NOW);
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	const diffDays = Math.round((NOW - epochMs) / 86_400_000);
	if (diffDays <= 6) return d.toLocaleDateString("en-GB", { weekday: "short" });
	return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ------------------------------------------------------------------ */
/* Accounts: personal (gmail-ish), work, muted hobby                  */
/* ------------------------------------------------------------------ */

export const personalId = "acc_personal";
export const workId = "acc_work";
export const hobbyId = "acc_hobby";

export const navAccounts: NavAccount[] = [
	{
		id: personalId,
		label: "Personal",
		email: "alice.tan@gmail.example",
		mailboxes: [
			{ id: "mbx_personal_inbox", name: "Inbox", role: "inbox", unseen: 9 },
			{ id: "mbx_personal_drafts", name: "Drafts", role: "drafts" },
			{ id: "mbx_personal_sent", name: "Sent", role: "sent" },
			{
				id: "mbx_personal_archive",
				name: "Archive",
				role: "archive",
			},
			{
				id: "mbx_personal_junk",
				name: "Junk",
				role: "junk",
				unseen: 2,
			},
			{ id: "mbx_personal_trash", name: "Trash", role: "trash" },
		],
	},
	{
		id: workId,
		label: "Work",
		email: "alice@northwind.example",
		mailboxes: [
			{ id: "mbx_work_inbox", name: "Inbox", role: "inbox", unseen: 14 },
			{ id: "mbx_work_sent", name: "Sent", role: "sent" },
			{ id: "mbx_work_archive", name: "Archive", role: "archive" },
			{ id: "mbx_work_junk", name: "Junk", role: "junk" },
			{ id: "mbx_work_trash", name: "Trash", role: "trash" },
		],
	},
	{
		id: hobbyId,
		label: "Synthwave Forum",
		email: "alice@synthcollective.example",
		muted: true,
		mailboxes: [
			{ id: "mbx_hobby_inbox", name: "Inbox", role: "inbox", unseen: 31 },
		],
	},
];

/* ------------------------------------------------------------------ */
/* Threads (~25 across the three accounts)                            */
/* ------------------------------------------------------------------ */

type Row = Omit<ThreadRowData, "timeLabel"> & { date: number };

const rows: Row[] = [
	// --- today, work ---
	{
		id: "thr_phish",
		accountId: personalId,
		fromName: "Mondial Relay",
		fromEmail: "delivery.notice.4421@gmail.example",
		subject: "Votre colis est en attente — confirmez la livraison",
		snippet:
			"Votre colis n°FR-88412 est en attente dans notre entrepôt. Confirmez votre adresse sous 48h pour éviter le retour…",
		date: ago(0.2),
		isRead: false,
		category: "automated",
		trust: "unknown",
		suspicious: true,
	},
	{
		id: "thr_q3",
		accountId: workId,
		fromName: "Priya Natarajan",
		fromEmail: "priya@northwind.example",
		subject: "Q3 roadmap review — agenda + pre-read",
		snippet:
			"Sharing the agenda ahead of Thursday. Two open questions on the billing migration I'd like your read on before we lock scope.",
		date: ago(0.6),
		isRead: false,
		trust: "vip",
		category: "personal",
		messageCount: 3,
	},
	{
		id: "thr_mom",
		accountId: personalId,
		fromName: "Mei Tan",
		fromEmail: "mei.tan@gmail.example",
		subject: "Sunday lunch?",
		snippet:
			"Your dad found a new dim sum place near the market. Are you free this Sunday around noon? Bring Jord if he's around.",
		date: ago(1),
		isRead: false,
		trust: "vip",
		category: "personal",
	},
	{
		id: "thr_incident",
		accountId: workId,
		fromName: "Northwind Statuspage",
		fromEmail: "alerts@status.northwind.example",
		subject: "[resolved] Elevated IMAP sync latency eu-west-1",
		snippet:
			"The incident affecting IMAP sync latency in eu-west-1 has been resolved. Duration: 23 minutes. Root cause analysis to follow.",
		date: ago(1.4),
		isRead: false,
		category: "automated",
	},
	{
		id: "thr_marcus",
		accountId: workId,
		fromName: "Marcus Webb",
		fromEmail: "marcus@northwind.example",
		subject: "Re: Reading pane density — a vote for calmer",
		snippet:
			"Strong +1 on tightening the list rows but keeping the reading pane airy. Gmail fatigue is real. Mocked two options, see attached.",
		date: ago(2),
		isRead: false,
		trust: "wellknown",
		category: "personal",
		hasAttachment: true,
		messageCount: 5,
	},
	{
		id: "thr_ci",
		accountId: workId,
		fromName: "Remit CI",
		fromEmail: "ci@northwind.example",
		subject: "[remit] Deploy to prod succeeded",
		snippet:
			"Pipeline #4821 finished in 6m 12s. 3 stacks updated, 0 drift. View the run for the cdk diff.",
		date: ago(2.4),
		isRead: true,
		category: "automated",
	},
	{
		id: "thr_linear",
		accountId: workId,
		fromName: "Linear",
		fromEmail: "billing@linear.example",
		subject: "Your receipt from Linear",
		snippet:
			"Receipt #LIN-20260610 · $80.00 charged to Visa •••• 4242. Thanks for your business.",
		date: ago(3),
		isRead: true,
		category: "transactional",
	},
	{
		id: "thr_dentist",
		accountId: personalId,
		fromName: "Tandarts Jansen",
		fromEmail: "afspraak@tandartsjansen.example",
		subject: "Herinnering: afspraak donderdag 11 juni, 14:15",
		snippet:
			"Dit is een herinnering voor uw afspraak op donderdag 11 juni om 14:15. Kunt u niet komen? Zeg dan uiterlijk 24 uur van tevoren af.",
		date: ago(4),
		isRead: false,
		category: "transactional",
	},
	{
		id: "thr_dana",
		accountId: workId,
		fromName: "Dana Okafor",
		fromEmail: "dana@northwind.example",
		subject: "Offsite logistics — rooms, travel, the dinner",
		snippet:
			"Final headcount is 14. I've held rooms at the Conservatorium through Friday — confirm yours by EOD Wed or they release.",
		date: ago(18),
		isRead: true,
		starred: true,
		trust: "wellknown",
		category: "personal",
		messageCount: 7,
	},
	{
		id: "thr_bol",
		accountId: personalId,
		fromName: "bol.com",
		fromEmail: "verzending@bol.example",
		subject: "Je pakket komt morgen tussen 10:15 en 12:45",
		snippet:
			"Goed nieuws! Je bestelling met USB-C dock en 2 boeken is onderweg. Volg je pakket via de track & trace link.",
		date: ago(20),
		isRead: true,
		category: "transactional",
	},
	{
		id: "thr_pragmatic",
		accountId: personalId,
		fromName: "The Pragmatic Engineer",
		fromEmail: "newsletter@pragmaticengineer.example",
		subject: "Platform teams that scale",
		snippet:
			"This week: how three companies structured their platform org, the build-vs-buy line for internal tooling, and a reader Q&A.",
		date: ago(22),
		isRead: false,
		category: "newsletter",
	},
	{
		id: "thr_kube",
		accountId: workId,
		fromName: "Grafana Cloud",
		fromEmail: "alerts@grafana.example",
		subject: "[FIRING:1] imap-worker error rate > 2%",
		snippet:
			"Alert imap-worker-errors fired at 11:02 UTC. Error rate 2.4% over 10m window. Runbook: doc/runbooks/imap-worker.md",
		date: ago(26),
		isRead: true,
		category: "automated",
	},
	{
		id: "thr_sven",
		accountId: workId,
		fromName: "Sven Larsen",
		fromEmail: "sven@northwind.example",
		subject: "Interview debrief — staff engineer loop",
		snippet:
			"Scorecards are in for both candidates. I'd like 20 minutes tomorrow to compare notes before we write the packet.",
		date: ago(28),
		isRead: false,
		trust: "wellknown",
		category: "personal",
		messageCount: 2,
	},
	{
		id: "thr_github",
		accountId: workId,
		fromName: "GitHub",
		fromEmail: "notifications@github.example",
		subject: "[northwind/remit] PR #418: fix thread reconstruction",
		snippet:
			"marcus-webb requested your review on: fix(threading): handle missing In-Reply-To when References is present.",
		date: ago(30),
		isRead: false,
		category: "automated",
	},
	{
		id: "thr_strava",
		accountId: personalId,
		fromName: "Strava",
		fromEmail: "no-reply@strava.example",
		subject: "Jord gave you kudos on your morning ride",
		snippet:
			"Jord and 3 others gave you kudos on 'Amstel loop before standup'.",
		date: ago(32),
		isRead: true,
		category: "social",
	},
	{
		id: "thr_airbnb",
		accountId: personalId,
		fromName: "Airbnb",
		fromEmail: "automated@airbnb.example",
		subject: "Your reservation in Lisbon is confirmed",
		snippet:
			"Check-in Sat, Jul 4 · 2 guests · Alfama apartment with balcony. Your host Marta will send check-in details closer to the date.",
		date: ago(45),
		isRead: true,
		starred: true,
		category: "transactional",
	},
	{
		id: "thr_meetup",
		accountId: personalId,
		fromName: "Meetup",
		fromEmail: "info@meetup.example",
		subject: "AWS User Group Amsterdam meets Thursday",
		snippet:
			"Serverless email infrastructure at scale — doors 18:00, talks 18:30, drinks after. 124 going.",
		date: ago(50),
		isRead: true,
		category: "social",
	},
	{
		id: "thr_kpn",
		accountId: personalId,
		fromName: "KPN",
		fromEmail: "factuur@kpn.example",
		subject: "Je factuur van juni staat klaar",
		snippet:
			"Je maandfactuur van €42,50 staat klaar in MijnKPN. Het bedrag wordt rond 16 juni afgeschreven.",
		date: ago(55),
		isRead: true,
		category: "transactional",
	},
	{
		id: "thr_retro",
		accountId: workId,
		fromName: "Asana",
		fromEmail: "no-reply@asana.example",
		subject: "Sprint retro notes assigned to you: 2 follow-ups",
		snippet:
			"Dana assigned you 'document the outbox retry policy' and 'file the DKIM edge case as an RFC' — due Friday.",
		date: ago(70),
		isRead: true,
		category: "automated",
	},
	{
		id: "thr_lopen",
		accountId: workId,
		fromName: "Priya Natarajan",
		fromEmail: "priya@northwind.example",
		subject: "Lunch walk Wednesday?",
		snippet:
			"Weather looks decent. Usual canal loop at 12:30? I want to pick your brain on the intelligence sidebar scope anyway.",
		date: ago(75),
		isRead: true,
		trust: "vip",
		category: "personal",
	},
	{
		id: "thr_substack",
		accountId: personalId,
		fromName: "Money Stuff",
		fromEmail: "byrne@newsletter.example",
		subject: "The index fund that ate the world",
		snippet:
			"Programming note: Money Stuff will be off tomorrow. Also: private credit, again. And a reader asks about insider trading on the moon.",
		date: ago(78),
		isRead: true,
		category: "newsletter",
	},
	{
		id: "thr_marketing",
		accountId: personalId,
		fromName: "Coolblue",
		fromEmail: "aanbiedingen@coolblue.example",
		subject: "Tot 30% korting op monitoren — alleen deze week",
		snippet:
			'Zomerdeals: 27" 4K monitoren vanaf €249. Voor 23:59 besteld, morgen gratis bezorgd.',
		date: ago(96),
		isRead: true,
		category: "marketing",
	},
	{
		id: "thr_security",
		accountId: workId,
		fromName: "Northwind Security",
		fromEmail: "no-reply@accounts.northwind.example",
		subject: "New sign-in to your account",
		snippet:
			"We noticed a new sign-in from Amsterdam, NL on a Mac. If this was you, no action is needed.",
		date: ago(100),
		isRead: true,
		category: "automated",
	},
	{
		id: "thr_wahlberg",
		accountId: workId,
		fromName: "Eva Lindqvist",
		fromEmail: "eva@vendor-analytics.example",
		subject: "Following up: analytics pilot proposal",
		snippet:
			"Hi Alice, circling back on the pilot proposal I sent over two weeks ago. Happy to adjust scope if the timing is off.",
		date: ago(120),
		isRead: true,
		category: "personal",
	},
	{
		id: "thr_oldphish",
		accountId: workId,
		fromName: "DHL Express",
		fromEmail: "parcel.update.9917@hotmail.example",
		subject: "Action required: customs fee outstanding",
		snippet:
			"Your shipment is held at customs. Pay the outstanding fee of €2.99 to release your parcel within 24 hours…",
		date: ago(140),
		isRead: true,
		category: "automated",
		suspicious: true,
	},
	// --- muted hobby account: still syncing, never in unified views ---
	{
		id: "thr_synth1",
		accountId: hobbyId,
		fromName: "Synth Collective",
		fromEmail: "digest@synthcollective.example",
		subject: "Weekly digest: 14 new threads in Modular",
		snippet:
			"Top thread: 'Behringer clones — ethical or essential?' (89 replies). Plus: patch notes from the meet.",
		date: ago(12),
		isRead: false,
		category: "newsletter",
	},
	{
		id: "thr_synth2",
		accountId: hobbyId,
		fromName: "Reverb",
		fromEmail: "offers@reverb.example",
		subject: "Price drop on your watched item: Juno-106",
		snippet: "A Juno-106 you're watching dropped from €1,450 to €1,280.",
		date: ago(40),
		isRead: false,
		category: "marketing",
	},
];

export const allThreads: ThreadRowData[] = rows.map(({ date, ...row }) => ({
	...row,
	timeLabel: timeLabel(date),
}));

/* ------------------------------------------------------------------ */
/* Reading-pane threads                                               */
/* ------------------------------------------------------------------ */

export const q3Thread: ThreadData = {
	subject: "Q3 roadmap review — agenda + pre-read",
	messages: [
		{
			id: "msg_q3_1",
			fromName: "Priya Natarajan",
			fromEmail: "priya@northwind.example",
			toLabel: "Alice Tan, Marcus Webb",
			dateLabel: "Mon 14:10",
			snippet: "First pass at the agenda — shout if I missed a topic.",
			bodyHtml: "",
		},
		{
			id: "msg_q3_2",
			fromName: "Marcus Webb",
			fromEmail: "marcus@northwind.example",
			toLabel: "Priya Natarajan, Alice Tan",
			dateLabel: "Mon 16:42",
			snippet:
				"Added the threading backlog item. Also: can we timebox the billing part?",
			bodyHtml: "",
		},
		{
			id: "msg_q3_3",
			fromName: "Priya Natarajan",
			fromEmail: "priya@northwind.example",
			toLabel: "Alice Tan, Marcus Webb",
			dateLabel: "Today 08:52",
			expanded: true,
			snippet: "Final agenda + two open questions on the billing migration.",
			bodyHtml: `<p>Hi both,</p>
<p>Final agenda for Thursday's roadmap review. Two open questions on the billing migration I'd like your read on before we lock scope:</p>
<ol><li>Do we keep the legacy export path through Q4, or cut it at GA?</li><li>Who owns the dunning emails once self-serve ships?</li></ol>
<p>Pre-read is in the deck (slides 4–9). 20 min should cover it.</p>
<p>Thanks,<br/>Priya</p>`,
		},
	],
};

/** The mail the kickoff call is read out of, and the clock it never names. */
export const lisbonCallThread: ThreadData = {
	subject: "Kickoff call on Wednesday at 16:00",
	messages: [
		{
			id: "msg_lisbon_call_1",
			fromName: "Rita Sousa",
			fromEmail: "rita@aldeia.example",
			toLabel: "Alice Tan",
			dateLabel: "Today 08:12",
			expanded: true,
			snippet:
				"Wednesday at 16:00 works on our side for the kickoff — I will send a link.",
			bodyHtml: `<p>Hi Alice,</p>
<p>Wednesday at 16:00 works on our side for the kickoff. I will send a link nearer the day.</p>
<p>Rita</p>`,
		},
	],
};

export const q3Intelligence: IntelligenceData = {
	sender: {
		name: "Priya Natarajan",
		email: "priya@northwind.example",
		trust: "vip",
		firstSeenLabel: "Jan 2025",
		inboundCount: 218,
		replyCount: 164,
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "northwind.example",
		dkimDomain: "northwind.example",
		summary: "DKIM signature aligns with northwind.example. Nothing unusual.",
	},
	category: { value: "personal" },
	flags: { vip: true },
	similar: [
		{
			id: "sim_q2",
			mailboxId: "mbx_work_inbox",
			threadId: "thr-sim_q2",
			fromName: "Priya Natarajan",
			subject: "Q2 roadmap review — agenda",
			timeLabel: "Mar",
			matched: "subject",
		},
		{
			id: "sim_billing",
			mailboxId: "mbx_work_inbox",
			threadId: "thr-sim_billing",
			fromName: "Marcus Webb",
			subject: "Billing migration: cutover checklist",
			timeLabel: "May",
			matched: "body",
		},
	],
};
