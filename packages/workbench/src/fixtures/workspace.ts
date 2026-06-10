import type {
	IntelligenceData,
	NavAccount,
	ThreadData,
	ThreadRowData,
	ThreadSection,
} from "@remit/ui";

/**
 * Multi-account workbench fixtures: three accounts (personal gmail-ish,
 * work, a muted hobby account), ~25 threads with realistic senders and
 * timestamps relative to a fixed "today", plus thread + intelligence data
 * for the benign and phishing reading-pane scenarios.
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
			{ id: "mbx_personal_inbox", name: "Inbox", unseen: 9 },
			{ id: "mbx_personal_sent", name: "Sent" },
			{ id: "mbx_personal_archive", name: "Archive" },
		],
	},
	{
		id: workId,
		label: "Work",
		email: "alice@northwind.example",
		mailboxes: [
			{ id: "mbx_work_inbox", name: "Inbox", unseen: 14 },
			{ id: "mbx_work_sent", name: "Sent" },
			{ id: "mbx_work_archive", name: "Archive" },
		],
	},
	{
		id: hobbyId,
		label: "Synthwave Forum",
		email: "alice@synthcollective.example",
		muted: true,
		mailboxes: [{ id: "mbx_hobby_inbox", name: "Inbox", unseen: 31 }],
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

/** Unified threads exclude muted accounts — they keep syncing regardless. */
const unified = allThreads.filter((t) => t.accountId !== hobbyId);

/* ------------------------------------------------------------------ */
/* Daily-brief grouping: attention sections                           */
/* ------------------------------------------------------------------ */

export function briefSections(accountId?: string): ThreadSection[] {
	const pool = accountId
		? unified.filter((t) => t.accountId === accountId)
		: unified;
	const attention = pool.filter(
		(t) => !t.isRead && (t.trust === "vip" || t.trust === "wellknown"),
	);
	const flagged = pool.filter((t) => t.starred && !attention.includes(t));
	const rest = pool.filter(
		(t) => !attention.includes(t) && !flagged.includes(t),
	);
	const sections: ThreadSection[] = [];
	if (attention.length > 0)
		sections.push({
			id: "attention",
			label: "Needs attention",
			threads: attention,
		});
	if (flagged.length > 0)
		sections.push({ id: "flagged", label: "Flagged", threads: flagged });
	if (rest.length > 0)
		sections.push({ id: "rest", label: "Everything else", threads: rest });
	return sections;
}

export const briefChips = (activeId?: string) => [
	{ id: "all", label: "All", active: !activeId },
	{
		id: personalId,
		label: "Personal",
		count: unified.filter((t) => t.accountId === personalId && !t.isRead)
			.length,
		active: activeId === personalId,
	},
	{
		id: workId,
		label: "Work",
		count: unified.filter((t) => t.accountId === workId && !t.isRead).length,
		active: activeId === workId,
	},
];

export const briefUnseen = unified.filter((t) => !t.isRead).length;

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
			fromName: "Priya Natarajan",
			subject: "Q2 roadmap review — agenda",
			timeLabel: "Mar",
			matched: "subject",
		},
		{
			id: "sim_billing",
			fromName: "Marcus Webb",
			subject: "Billing migration: cutover checklist",
			timeLabel: "May",
			matched: "body",
		},
	],
};

export const phishThread: ThreadData = {
	subject: "Votre colis est en attente — confirmez la livraison",
	warning:
		"This message claims to be from a company (Mondial Relay) but was sent from a personal gmail.example mailbox.",
	messages: [
		{
			id: "msg_phish_1",
			fromName: "Mondial Relay",
			fromEmail: "delivery.notice.4421@gmail.example",
			toLabel: "alice.tan@gmail.example",
			dateLabel: "Today 09:18",
			expanded: true,
			snippet: "Votre colis n°FR-88412 est en attente dans notre entrepôt.",
			bodyHtml: `<p>Cher(e) client(e),</p>
<p>Votre colis <strong>n°FR-88412</strong> est en attente dans notre entrepôt. Des frais de livraison de <strong>1,99&nbsp;€</strong> restent impayés.</p>
<p>Confirmez votre adresse et réglez les frais sous 48h pour éviter le retour à l'expéditeur&nbsp;:</p>
<p><a href="#">▶ Confirmer la livraison</a></p>
<p>Mondial Relay — Service Livraison</p>`,
		},
	],
};

export const phishIntelligence: IntelligenceData = {
	sender: {
		name: "Mondial Relay",
		email: "delivery.notice.4421@gmail.example",
		trust: "unknown",
		firstSeenLabel: "today",
		inboundCount: 1,
		replyCount: 0,
	},
	authenticity: {
		verdict: "mismatch",
		fromDomain: "mondialrelay.fr",
		dkimDomain: "gmail.example",
		claimedBrand: "Mondial Relay",
		summary:
			"The display name claims “Mondial Relay”, but the message was sent and signed by a personal gmail.example mailbox — not mondialrelay.fr. Real carriers send from their own domain.",
		similarCount: 15,
	},
	category: { value: "automated" },
	flags: {},
	similar: [
		{
			id: "sim_dhl",
			fromName: "DHL Express",
			subject: "Action required: customs fee outstanding",
			timeLabel: "Thu",
			matched: "body",
		},
		{
			id: "sim_postnl",
			fromName: "PostNL",
			subject: "Uw pakket kon niet worden bezorgd",
			timeLabel: "28 May",
			matched: "body",
		},
		{
			id: "sim_ups",
			fromName: "UPS Notify",
			subject: "Delivery attempt failed — reschedule now",
			timeLabel: "21 May",
			matched: "subject",
		},
		{
			id: "sim_colissimo",
			fromName: "Colissimo",
			subject: "Frais de douane en attente de paiement",
			timeLabel: "14 May",
			matched: "entities",
		},
	],
};

/* ------------------------------------------------------------------ */
/* Naughty newsletter: a garish centered-600px HTML table blast.      */
/* Stress-tests the left-aligned reading pane + content frame: the    */
/* email keeps its own light colors INSIDE the hairline frame (never  */
/* dark-inverted), so in dark mode the brightness stays contained.    */
/* Self-contained: no remote assets, colored blocks stand in for      */
/* product images.                                                    */
/* ------------------------------------------------------------------ */

const imgBlock = (bg: string, label: string, h = 96) =>
	`<div style="height:${h}px;background:${bg};display:flex;align-items:center;justify-content:center;color:#ffffff;font-weight:700;font-size:13px;letter-spacing:1px;">${label}</div>`;

const newsletterHtml = `
<div style="background:#f2f2f2;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
	<table align="center" width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;width:600px;max-width:100%;background:#ffffff;border-collapse:collapse;">
		<tr><td style="background:#0090e3;padding:14px 24px;color:#ffffff;font-size:20px;font-weight:800;">
			coolblue<span style="color:#ff6600;">.</span> <span style="float:right;font-size:11px;font-weight:400;padding-top:6px;">Alles voor een glimlach</span>
		</td></tr>
		<tr><td style="background:linear-gradient(135deg,#ff6600,#ff9a3d);padding:36px 24px;text-align:center;color:#ffffff;">
			<div style="font-size:30px;font-weight:900;line-height:1.1;">ZOMERDEALS ☀️</div>
			<div style="font-size:15px;margin-top:8px;">Tot 30% korting op monitoren — alleen deze week</div>
			<a href="#deals" style="display:inline-block;margin-top:18px;background:#ffffff;color:#ff6600;font-weight:800;font-size:15px;padding:13px 34px;border-radius:999px;text-decoration:none;">SHOP NU →</a>
		</td></tr>
		<tr><td style="padding:20px 24px 6px;color:#111111;font-size:17px;font-weight:800;">Onze toppers voor jou</td></tr>
		<tr><td style="padding:6px 24px 20px;">
			<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px;">
				<tr>
					<td width="50%" style="border:1px solid #e5e5e5;">${imgBlock("#2b3a55", "27″ 4K MONITOR")}<div style="padding:10px 12px;font-size:13px;color:#111;">LG UltraFine 27&Prime;<br/><b style="color:#ff6600;font-size:16px;">€249,-</b> <s style="color:#999;">€349,-</s></div></td>
					<td width="50%" style="border:1px solid #e5e5e5;">${imgBlock("#4a5d23", "ERGO CHAIR")}<div style="padding:10px 12px;font-size:13px;color:#111;">BakkerElkhuizen stoel<br/><b style="color:#ff6600;font-size:16px;">€399,-</b> <s style="color:#999;">€499,-</s></div></td>
				</tr>
				<tr>
					<td width="50%" style="border:1px solid #e5e5e5;">${imgBlock("#7a3045", "USB-C DOCK")}<div style="padding:10px 12px;font-size:13px;color:#111;">CalDigit TS4 dock<br/><b style="color:#ff6600;font-size:16px;">€299,-</b></div></td>
					<td width="50%" style="border:1px solid #e5e5e5;">${imgBlock("#1f6e6b", "KEYBOARD")}<div style="padding:10px 12px;font-size:13px;color:#111;">Keychron Q1 Pro<br/><b style="color:#ff6600;font-size:16px;">€189,-</b></div></td>
				</tr>
			</table>
		</td></tr>
		<tr><td style="background:#0090e3;padding:18px 24px;text-align:center;">
			<a href="#all-deals" style="display:inline-block;background:#ff6600;color:#ffffff;font-weight:800;font-size:14px;padding:12px 30px;border-radius:999px;text-decoration:none;">ALLE 412 DEALS BEKIJKEN</a>
		</td></tr>
		<tr><td style="padding:16px 24px;background:#f7f7f7;color:#888888;font-size:11px;text-align:center;line-height:1.5;">
			Je ontvangt deze mail omdat je bent ingeschreven voor aanbiedingen.<br/>
			<a href="#unsub" style="color:#0090e3;">Uitschrijven</a> · <a href="#prefs" style="color:#0090e3;">Voorkeuren</a> · Coolblue B.V., Weena 664, Rotterdam
		</td></tr>
	</table>
</div>`;

export const newsletterThread: ThreadData = {
	subject: "Tot 30% korting op monitoren — alleen deze week",
	messages: [
		{
			id: "msg_newsletter_1",
			fromName: "Coolblue",
			fromEmail: "aanbiedingen@coolblue.example",
			toLabel: "alice.tan@gmail.example",
			dateLabel: "Sat 09:00",
			expanded: true,
			framed: true,
			snippet: "Zomerdeals: 27″ 4K monitoren vanaf €249.",
			bodyHtml: newsletterHtml,
		},
	],
};

export const newsletterIntelligence: IntelligenceData = {
	sender: {
		name: "Coolblue",
		email: "aanbiedingen@coolblue.example",
		trust: "unknown",
		firstSeenLabel: "Aug 2024",
		inboundCount: 142,
		replyCount: 0,
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "coolblue.example",
		dkimDomain: "coolblue.example",
		summary: "DKIM signature aligns with coolblue.example. Nothing unusual.",
	},
	category: { value: "marketing" },
	flags: {},
	similar: [
		{
			id: "sim_cb_1",
			fromName: "Coolblue",
			subject: "Black Friday vroegboekdeals",
			timeLabel: "30 May",
			matched: "sender",
		},
		{
			id: "sim_cb_2",
			fromName: "Coolblue",
			subject: "Laatste kans: gratis bezorging weekend",
			timeLabel: "23 May",
			matched: "sender",
		},
		{
			id: "sim_mm",
			fromName: "MediaMarkt",
			subject: "Outlet: monitoren en docks afgeprijsd",
			timeLabel: "19 May",
			matched: "body",
		},
	],
};

/* ------------------------------------------------------------------ */
/* Search fixtures                                                    */
/* ------------------------------------------------------------------ */

export interface SemanticHit {
	thread: ThreadRowData;
	matched:
		| "sender"
		| "recipient"
		| "subject"
		| "attachment"
		| "body"
		| "entities";
	score: number;
}

export const searchQuery = "parcel delivery confirmation";

/**
 * Search spans the whole mail history, not just the visible threads —
 * archival rows below exist only as search results, which is what makes
 * the per-section limit + expando necessary.
 */
function archival(
	id: string,
	fromName: string,
	fromEmail: string,
	subject: string,
	snippet: string,
	timeLabel: string,
	overrides: Partial<ThreadRowData> = {},
): ThreadRowData {
	return {
		id,
		accountId: personalId,
		fromName,
		fromEmail,
		subject,
		snippet,
		timeLabel,
		isRead: true,
		category: "transactional",
		...overrides,
	};
}

export const instantResults: ThreadRowData[] = [
	...allThreads.filter((t) =>
		["thr_phish", "thr_bol", "thr_oldphish"].includes(t.id),
	),
	archival(
		"thr_arch_postnl",
		"PostNL",
		"noreply@postnl.example",
		"Je pakket is bezorgd",
		"Je pakket met track & trace 3SABCD is bezorgd bij de buren op nummer 14.",
		"12 May",
	),
	archival(
		"thr_arch_dhl",
		"DHL",
		"noreply@dhl.example",
		"Your DHL parcel is on its way",
		"Parcel 00340… is on its way. Estimated delivery window Thursday 09:00–12:00.",
		"4 May",
	),
	archival(
		"thr_arch_etsy",
		"Etsy",
		"transaction@etsy.example",
		"Your order shipped — delivery confirmation inside",
		"GoodWoodWorkshop shipped your order. Track your parcel for delivery updates.",
		"27 Apr",
	),
	archival(
		"thr_arch_ups",
		"UPS",
		"mcinfo@ups.example",
		"UPS delivery confirmation 1Z999AA1",
		"Your parcel was delivered and signed for by A. TAN at the front door.",
		"19 Apr",
	),
	archival(
		"thr_arch_coolblue",
		"Coolblue",
		"bezorging@coolblue.example",
		"Vandaag bezorgd: je USB-C dock",
		"Bezorgbevestiging: je pakket is vandaag om 11:42 bezorgd. Alles voor een glimlach.",
		"2 Apr",
	),
];

export const semanticResults: SemanticHit[] = [
	{
		thread: allThreads.find((t) => t.id === "thr_airbnb") as ThreadRowData,
		matched: "body",
		score: 0.91,
	},
	{
		thread: allThreads.find((t) => t.id === "thr_kpn") as ThreadRowData,
		matched: "entities",
		score: 0.84,
	},
	{
		thread: allThreads.find((t) => t.id === "thr_marketing") as ThreadRowData,
		matched: "subject",
		score: 0.78,
	},
	{
		thread: archival(
			"thr_arch_ns",
			"NS International",
			"tickets@ns.example",
			"Your e-tickets to Paris",
			"Your booking is confirmed. E-tickets attached — they will also be scanned at the gate.",
			"Mar",
			{ hasAttachment: true },
		),
		matched: "attachment",
		score: 0.74,
	},
	{
		thread: archival(
			"thr_arch_ikea",
			"IKEA",
			"order@ikea.example",
			"We've received your return",
			"Your return was received at our warehouse. Refund follows within 5 working days.",
			"Mar",
		),
		matched: "body",
		score: 0.71,
	},
	{
		thread: archival(
			"thr_arch_marktplaats",
			"Marktplaats",
			"no-reply@marktplaats.example",
			"Verzendcode voor je verkochte item",
			"Gefeliciteerd met je verkoop! Gebruik deze verzendcode bij het PostNL-punt.",
			"Feb",
		),
		matched: "entities",
		score: 0.66,
	},
	{
		thread: archival(
			"thr_arch_aliexpress",
			"AliExpress",
			"order@aliexpress.example",
			"Package update: clearing customs",
			"Your package passed export customs clearance and is in transit to the destination country.",
			"Feb",
		),
		matched: "body",
		score: 0.62,
	},
];
