/**
 * What the two destructive feed actions say before they are taken.
 *
 * Both take a working subscription away from whoever holds the address, and
 * neither can be undone by re-minting — the new address is a different secret.
 * The copy names the calendar, so a confirmation opened from the wrong row is
 * visibly the wrong one.
 */

export interface FeedConfirmCopy {
	title: string;
	description: string;
}

export const rotateFeedConfirmCopy = (
	calendarName: string,
): FeedConfirmCopy => ({
	title: `Replace the address for ${calendarName}?`,
	description:
		"Every client already subscribed to the current address stops updating and has to be pointed at the new one. The new address is shown once.",
});

export const revokeFeedConfirmCopy = (
	calendarName: string,
): FeedConfirmCopy => ({
	title: `Stop sharing ${calendarName}?`,
	description:
		"The address stops working immediately and every client subscribed to it stops updating. Sharing again mints a different address.",
});
