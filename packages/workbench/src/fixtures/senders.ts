/**
 * Senders & Rules fixtures: enough rows (~45) to prove the dense table
 * scales to hundreds of flagged senders. Deterministic engagement numbers
 * derived from the name so the table is stable across reloads.
 */

export type SenderGroup = "vip" | "muted" | "blocked";

export interface SenderEntry {
	id: string;
	name: string;
	email: string;
	group: SenderGroup;
	inboundCount: number;
	replyCount: number;
	/** Flag provenance, e.g. "muted Mar 2026 — too chatty". */
	caption: string;
}

function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

function entry(
	name: string,
	email: string,
	group: SenderGroup,
	caption: string,
): SenderEntry {
	const h = hash(email);
	const inboundCount =
		group === "vip"
			? 40 + (h % 260)
			: group === "muted"
				? 30 + (h % 400)
				: 1 + (h % 6);
	const replyCount =
		group === "vip" ? Math.max(8, Math.round(inboundCount * 0.6)) : 0;
	return {
		id: `snd_${email}`,
		name,
		email,
		group,
		inboundCount,
		replyCount,
		caption,
	};
}

const vipNames: [string, string][] = [
	["Priya Natarajan", "priya@northwind.example"],
	["Mei Tan", "mei.tan@gmail.example"],
	["Marcus Webb", "marcus@northwind.example"],
	["Dana Okafor", "dana@northwind.example"],
	["Sven Larsen", "sven@northwind.example"],
	["Jord Visser", "jord.visser@gmail.example"],
	["Aisha Khan", "aisha@northwind.example"],
	["Tom Bakker", "tom.bakker@freelance.example"],
	["Lena Fischer", "lena@designstudio.example"],
	["Ravi Mehta", "ravi@northwind.example"],
	["Sofia Lindgren", "sofia@partnerco.example"],
	["Hugo Martens", "hugo.martens@gmail.example"],
	["Carmen Diaz", "carmen@northwind.example"],
	["Pieter de Groot", "pieter@accountant.example"],
	["Yuki Tanaka", "yuki@northwind.example"],
	["Femke Jansen", "femke.jansen@gmail.example"],
];

const mutedNames: [string, string, string][] = [
	["Coolblue", "aanbiedingen@coolblue.example", "muted Mar 2026 — too chatty"],
	["Strava", "no-reply@strava.example", "muted Feb 2026"],
	["Medium Digest", "digest@medium.example", "muted Jan 2026"],
	[
		"LinkedIn",
		"updates@linkedin.example",
		"muted Dec 2025 — notification spam",
	],
	["Duolingo", "owl@duolingo.example", "muted Nov 2025"],
	["Quora Digest", "digest@quora.example", "muted Nov 2025"],
	["Booking.com", "deals@booking.example", "muted Oct 2025"],
	["AliExpress", "promo@aliexpress.example", "muted Oct 2025"],
	["Twitch", "notifications@twitch.example", "muted Sep 2025"],
	["Pinterest", "inspiration@pinterest.example", "muted Sep 2025"],
	["Goodreads", "newsletter@goodreads.example", "muted Aug 2025"],
	["Bandcamp Weekly", "weekly@bandcamp.example", "muted Aug 2025"],
	["Reverb", "offers@reverb.example", "muted Jul 2025 — watch list only"],
	["NS Reisinformatie", "service@ns.example", "muted Jun 2025"],
	["Albert Heijn", "bonus@ah.example", "muted Jun 2025"],
	["Decathlon", "sport@decathlon.example", "muted May 2025"],
	["Eventbrite", "events@eventbrite.example", "muted May 2025"],
	["Patreon", "updates@patreon.example", "muted Apr 2025"],
];

const blockedNames: [string, string, string][] = [
	[
		"Mondial Relay",
		"delivery.notice.4421@gmail.example",
		"blocked today — impersonation",
	],
	[
		"DHL Express",
		"parcel.update.9917@hotmail.example",
		"blocked Jun 2026 — impersonation",
	],
	[
		"PostNL",
		"bezorging.afspraak.221@outlook.example",
		"blocked May 2026 — impersonation",
	],
	[
		"Crypto Signals VIP",
		"winning.trades.88@gmail.example",
		"blocked Apr 2026 — scam",
	],
	[
		"IT Helpdesk",
		"password.reset.4471@yahoo.example",
		"blocked Mar 2026 — credential phish",
	],
	[
		"Belastingdienst",
		"teruggave.direct@gmail.example",
		"blocked Feb 2026 — impersonation",
	],
	[
		"Microsoft Support",
		"account.security.911@hotmail.example",
		"blocked Jan 2026 — scam",
	],
	["Lotto Winnaar", "prijs.uitkering@gmail.example", "blocked Dec 2025 — scam"],
];

export const senders: SenderEntry[] = [
	...vipNames.map(([name, email], i) =>
		entry(
			name,
			email,
			"vip",
			`VIP since ${["Jan", "Feb", "Mar", "Apr"][i % 4]} 2026`,
		),
	),
	...mutedNames.map(([name, email, caption]) =>
		entry(name, email, "muted", caption),
	),
	...blockedNames.map(([name, email, caption]) =>
		entry(name, email, "blocked", caption),
	),
];

export const senderGroupLabels: Record<SenderGroup, string> = {
	vip: "VIPs",
	muted: "Muted",
	blocked: "Blocked",
};

export function sendersByGroup(group: SenderGroup): SenderEntry[] {
	return senders.filter((s) => s.group === group);
}
