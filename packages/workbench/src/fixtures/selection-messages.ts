import type { SearchConversion, WizardMessage } from "@remit/ui";

/** A row of the mail list the selection wizard opens from. */
export interface SelectionMessage extends WizardMessage {
	email: string;
	preview: string;
}

export const SELECTION_SAMPLE: SelectionMessage[] = [
	{
		id: "m1",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Booking confirmation: Hotel Bairro Alto",
		preview: "Your stay in Lisbon is confirmed for Jul 12–16.",
		date: "Jul 2",
	},
	{
		id: "m2",
		sender: "Airbnb",
		email: "automated@airbnb.com",
		subject: "Your reservation is confirmed – Lisbon",
		preview: "Miguel is expecting you on Friday at 15:00.",
		date: "Jun 28",
	},
	{
		id: "m3",
		sender: "Expedia",
		email: "travel@expediamail.com",
		subject: "Itinerary for your upcoming trip",
		preview: "Flight IB3109 departs Amsterdam 09:40.",
		date: "Jun 27",
	},
	{
		id: "m4",
		sender: "Trainline",
		email: "tickets@thetrainline.com",
		subject: "Your ticket for Lisboa → Porto",
		preview: "Coach 4, seat 21A. Show this QR at the gate.",
		date: "Jun 24",
	},
	{
		id: "m5",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "How was your stay?",
		preview: "Leave a review and help other travellers.",
		date: "Jun 19",
	},
	{
		id: "m6",
		sender: "Ryanair",
		email: "noreply@ryanair.com",
		subject: "Check-in is now open",
		preview: "Check in before Jul 11 to avoid the airport fee.",
		date: "Jun 18",
	},
	{
		id: "m7",
		sender: "KLM",
		email: "info@klm.com",
		subject: "Your boarding pass for KL1695",
		preview: "Gate D14 closes 20 minutes before departure.",
		date: "Jun 17",
	},
	{
		id: "m8",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Your stay in Porto is 3 weeks away",
		preview: "Casa do Conto expects you on Jul 16.",
		date: "Jun 15",
	},
	{
		id: "m9",
		sender: "Rome2Rio",
		email: "hello@rome2rio.com",
		subject: "Getting from Porto airport to the centre",
		preview: "Metro line E runs every 20 minutes until 01:00.",
		date: "Jun 14",
	},
	{
		id: "m10",
		sender: "Sixt",
		email: "noreply@sixt.com",
		subject: "Rental agreement 4471-9930",
		preview: "Pick up Jul 18, 10:00, Porto Campanhã.",
		date: "Jun 11",
	},
	{
		id: "m11",
		sender: "Airbnb",
		email: "automated@airbnb.com",
		subject: "Miguel sent you a message",
		preview: "The key box code is on the door to the left.",
		date: "Jun 9",
	},
	{
		id: "m12",
		sender: "Trainline",
		email: "tickets@thetrainline.com",
		subject: "Refund processed for CP 4412",
		preview: "€24.50 is back on the card ending 4417.",
		date: "Jun 6",
	},
	{
		id: "m13",
		sender: "Expedia",
		email: "travel@expediamail.com",
		subject: "Price drop on your saved trip",
		preview: "Amsterdam → Faro is now €38 lower.",
		date: "Jun 4",
	},
	{
		id: "m14",
		sender: "GetYourGuide",
		email: "noreply@getyourguide.com",
		subject: "Your Douro valley tour is booked",
		preview: "Meet at Praça da Liberdade, 08:15.",
		date: "Jun 2",
	},
	{
		id: "m15",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Free cancellation ends tomorrow",
		preview: "Hotel Bairro Alto can still be changed until Jun 1.",
		date: "May 31",
	},
	{
		id: "m16",
		sender: "Ryanair",
		email: "noreply@ryanair.com",
		subject: "Schedule change on FR2455",
		preview: "Departure moved from 06:20 to 07:05.",
		date: "May 28",
	},
	{
		id: "m17",
		sender: "Revolut",
		email: "no-reply@revolut.com",
		subject: "Travel insurance for your Portugal trip",
		preview: "Cover starts the day you leave the country.",
		date: "May 26",
	},
	{
		id: "m18",
		sender: "Airbnb",
		email: "automated@airbnb.com",
		subject: "Receipt for your Porto reservation",
		preview: "Paid €412.00 on May 24.",
		date: "May 24",
	},
	{
		id: "m19",
		sender: "Skyscanner",
		email: "alerts@skyscanner.net",
		subject: "Fare alert: Lisbon in September",
		preview: "Return flights from €96 for the dates you watched.",
		date: "May 21",
	},
	{
		id: "m20",
		sender: "KLM",
		email: "info@klm.com",
		subject: "Choose your seats for KL1694",
		preview: "Rows 12 to 18 are still open at no charge.",
		date: "May 19",
	},
];

/**
 * A page of results for the query "npm". The rows are deliberately of three
 * kinds, so the two widened doors pull apart: mail that carries the word,
 * ecosystem mail that does not (a semantic reach), and unrelated mail that a
 * literal subject clause would still miss or catch by accident.
 */
export const SELECTION_SEARCH_SAMPLE: SelectionMessage[] = [
	{
		id: "s1",
		sender: "npm",
		email: "support@npmjs.com",
		subject: "npm: remit-ui@0.4.2 was published",
		preview: "A new version of a package you own is now on the registry.",
		date: "Jul 3",
	},
	{
		id: "s2",
		sender: "npm",
		email: "security@npmjs.com",
		subject: "npm security advisory affects 2 of your packages",
		preview: "A high-severity advisory was published for lodash.",
		date: "Jul 2",
	},
	{
		id: "s3",
		sender: "Node Weekly",
		email: "newsletter@cooperpress.com",
		subject: "Node.js 24 reaches LTS, plus 12 links",
		preview: "The release notes, the timeline, and what breaks.",
		date: "Jul 1",
	},
	{
		id: "s4",
		sender: "GitHub",
		email: "notifications@github.com",
		subject: "[remit] Dependabot: bump vite from 7.3.4 to 7.3.6",
		preview: "Automated dependency update opened a pull request.",
		date: "Jun 30",
	},
	{
		id: "s5",
		sender: "npm",
		email: "support@npmjs.com",
		subject: "npm now requires two-factor authentication",
		preview: "Publishing without 2FA stops working on Aug 1.",
		date: "Jun 29",
	},
	{
		id: "s6",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Booking confirmation: Hotel Bairro Alto",
		preview: "Your stay in Lisbon is confirmed for Jul 12–16.",
		date: "Jun 28",
	},
	{
		id: "s7",
		sender: "JavaScript Weekly",
		email: "newsletter@cooperpress.com",
		subject: "The state of bundlers in 2026",
		preview: "Rolldown lands, esbuild holds, and the numbers behind it.",
		date: "Jun 27",
	},
	{
		id: "s8",
		sender: "Eline",
		email: "eline@example.com",
		subject: "Re: can you look at the npm thing tonight?",
		preview: "It fails on my machine but not on the runner.",
		date: "Jun 26",
	},
	{
		id: "s9",
		sender: "Sentry",
		email: "noreply@sentry.io",
		subject: "New issue: TypeError in @remit/web-client",
		preview: "Seen 41 times in the last hour on production.",
		date: "Jun 25",
	},
	{
		id: "s10",
		sender: "npm",
		email: "support@npmjs.com",
		subject: "Your npm access token expires in 7 days",
		preview: "Rotate it before Jul 2 to keep publishing.",
		date: "Jun 22",
	},
	{
		id: "s11",
		sender: "LinkedIn",
		email: "jobs@linkedin.com",
		subject: "5 new Node.js roles near Amsterdam",
		preview: "Based on the skills on your profile.",
		date: "Jun 21",
	},
	{
		id: "s12",
		sender: "ABN AMRO",
		email: "noreply@abnamro.nl",
		subject: "Betaalbevestiging €218,00",
		preview: "Uw betaling is geslaagd op 20 juni 2026.",
		date: "Jun 20",
	},
];

/**
 * Three receipts from three different senders whose subjects share a run of
 * words. Senders that neither repeat nor share a domain are what pushes the
 * property prefill off the sender and onto the shared subject fragment.
 */
export const SELECTION_RECEIPTS_SAMPLE: SelectionMessage[] = [
	{
		id: "r1",
		sender: "Blue Bottle",
		email: "receipts@bluebottle.example",
		subject: "Your receipt from Blue Bottle #4821",
		preview: "Two bags of Bella Donovan, picked up in store.",
		date: "Jul 1",
	},
	{
		id: "r2",
		sender: "Ritual Coffee",
		email: "hello@ritual.example",
		subject: "Re: Your receipt from Ritual Coffee #119",
		preview: "Thanks for coming in — here is the copy you asked for.",
		date: "Jun 30",
	},
	{
		id: "r3",
		sender: "Sightglass",
		email: "no-reply@sightglass.example",
		subject: "Your receipt from Sightglass #77",
		preview: "Owl's Howl espresso, 1kg. Paid by card.",
		date: "Jun 28",
	},
	{
		id: "r4",
		sender: "Trainline",
		email: "tickets@thetrainline.com",
		subject: "Your ticket for Lisboa → Porto",
		preview: "Coach 4, seat 21A. Show this QR at the gate.",
		date: "Jun 24",
	},
];

export const SELECTION_FOLDERS = [
	"Archive",
	"Travel",
	"Travel/2026",
	"Receipts",
	"Newsletters",
	"Work",
	"Personal",
	"Junk",
];

/**
 * What `convertSearchToRule` hands the wizard for
 * `npm in:Archive is:unread before:2026-01-01` — a query carrying everything a
 * filter cannot: a folder it was limited to, two attribute facets, and free text
 * whose semantic reach a literal clause loses.
 */
export const RICH_CONVERSION: SearchConversion = {
	clauses: [{ field: "HasWords", value: "npm" }],
	matchOperator: "all",
	scopedOut: { mailboxId: "mbx-archive", label: "Archive" },
	droppedFacets: [
		{ type: "isUnread", label: "Unread" },
		{ type: "before", label: "Before 2026-01-01" },
	],
	keptTerms: true,
	droppedSemantic: true,
};

/** Plain words, nothing scoped or faceted: one clause and nothing to report. */
export const PLAIN_CONVERSION: SearchConversion = {
	clauses: [{ field: "HasWords", value: "npm" }],
	matchOperator: "all",
	droppedFacets: [],
	keptTerms: true,
	droppedSemantic: false,
};

/** `in:Archive is:unread` — nothing in it converts, so there is no filter to open. */
export const FACETS_ONLY_CONVERSION: SearchConversion = {
	clauses: [],
	matchOperator: "all",
	scopedOut: { mailboxId: "mbx-archive", label: "Archive" },
	droppedFacets: [{ type: "isUnread", label: "Unread" }],
	keptTerms: false,
	droppedSemantic: false,
};
