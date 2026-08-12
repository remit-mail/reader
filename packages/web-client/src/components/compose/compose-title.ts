/**
 * What the compose surface calls itself.
 *
 * The address says which message is being written, so the heading says the same
 * thing: a message with nothing saved behind it yet is a new one, and one the
 * autosave has written is the draft it wrote. The heading changing as the first
 * save lands is the same moment the action bar says "Draft saved".
 */
export const composeSurfaceTitle = (outboxMessageId: string | undefined) =>
	outboxMessageId ? "Draft" : "New Message";
