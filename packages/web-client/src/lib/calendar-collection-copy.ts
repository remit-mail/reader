export interface CollectionConfirmCopy {
	title: string;
	description: string;
}

export const deleteCalendarConfirmCopy = (
	calendarName: string,
): CollectionConfirmCopy => ({
	title: `Delete ${calendarName}?`,
	description: `This removes ${calendarName} and every event in it, and any subscription address stops working. It cannot be undone.`,
});

/** A starting address for a new calendar, from the name typed so far. */
export const calendarUrlSegmentFor = (displayName: string): string =>
	displayName
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
