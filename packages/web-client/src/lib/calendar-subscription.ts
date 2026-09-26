/**
 * Where a subscribed calendar's events come from, named by host alone. For a
 * Google feed the full address is the credential, so no surface draws it.
 */
export const subscriptionHostOf = (subscriptionUrl: string): string =>
	URL.canParse(subscriptionUrl)
		? new URL(subscriptionUrl).host
		: "an iCalendar feed";

export const subscriptionReadOnlyNote = (subscriptionUrl: string): string =>
	`Read-only: from ${subscriptionHostOf(subscriptionUrl)}. Change it where the feed comes from.`;
