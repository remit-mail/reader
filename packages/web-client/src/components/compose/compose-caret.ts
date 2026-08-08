/**
 * Where the caret goes when a compose surface opens: the recipient field, named
 * by the `data-compose-recipients` marker `ComposeForm` puts on it.
 */
const RECIPIENT_INPUT = "[data-compose-recipients] input";

export const focusComposeRecipients = (
	surface: HTMLElement | null | undefined,
): void => {
	surface?.querySelector<HTMLElement>(RECIPIENT_INPUT)?.focus();
};
