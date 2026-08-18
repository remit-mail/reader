/**
 * Whether the reader is already typing somewhere else.
 *
 * Both writing surfaces open with the caret in the message, and both arrive on
 * their own lazily-loaded chunk — so "on mount" is whenever that chunk lands.
 * On a cold cache that is well after the composer opened and the reader moved
 * on to the recipients, the subject or the search field, and claiming the caret
 * then takes it out of a sentence in progress: the rest of what they type goes
 * into the message body.
 *
 * Pressing a button to open the composer leaves focus on that button, which is
 * not typing — so the ordinary open still lands the caret in the message.
 */

/**
 * The types an `<input>` accepts prose in. Everything else it can be — a
 * checkbox, a radio, a button, a file or colour picker — is a control the
 * reader clicks, not one they are mid-word in.
 */
const TEXT_INPUT_TYPES = new Set([
	"text",
	"search",
	"email",
	"url",
	"tel",
	"password",
	"number",
	"date",
	"datetime-local",
	"month",
	"time",
	"week",
]);

/**
 * Focus as the reader experiences it. `activeElement` stops at a shadow host,
 * so a field inside a web component reports as the host; this walks in to the
 * element actually holding the caret.
 */
const deepActiveElement = (scope: Document | ShadowRoot): Element | null => {
	const active = scope.activeElement;
	if (!active?.shadowRoot) return active;
	return deepActiveElement(active.shadowRoot) ?? active;
};

/**
 * Whether text goes into this element. Read off the tag and the `type`
 * attribute rather than `instanceof`, which is per-realm and answers wrongly
 * for anything reached through a frame.
 */
const takesTyping = (element: Element): boolean => {
	const tag = element.tagName.toUpperCase();
	// A focused frame is a document of its own — whatever is being typed in
	// there is not ours to interrupt, and we cannot see it to ask.
	if (tag === "IFRAME" || tag === "FRAME") return true;
	if (tag === "TEXTAREA") return true;
	// Typeahead: a reader part-way through selecting an option is choosing with
	// the keyboard, and losing it drops them somewhere they did not pick.
	if (tag === "SELECT") return true;
	if (tag === "INPUT") {
		const type = (element.getAttribute("type") ?? "text").toLowerCase();
		return TEXT_INPUT_TYPES.has(type);
	}
	// The attribute as well as the property: `isContentEditable` is computed by
	// the engine, and a document that never lays out does not answer for it.
	const editable = element.getAttribute("contenteditable");
	if (editable !== null && editable.toLowerCase() !== "false") return true;
	return (element as Partial<HTMLElement>).isContentEditable === true;
};

export const isWritingElsewhere = (root: HTMLElement | null): boolean => {
	const owner = root?.ownerDocument ?? globalThis.document;
	if (!owner) return false;
	const active = deepActiveElement(owner);
	if (!active || active === root) return false;
	if (root?.contains(active)) return false;
	return takesTyping(active);
};
