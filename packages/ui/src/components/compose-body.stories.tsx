import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { defaultComposeLanguages } from "../lib/compose-language.js";
import { ComposeBody, type ConversionFailure } from "./compose-body.js";
import type { RichTextValue } from "./rich-text-value.js";

const RICH_DOCUMENT = [
	"<h2>Quarterly numbers</h2>",
	"<p>Revenue is <strong>up</strong> on the quarter.</p>",
	"<table><thead><tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
].join("");

const PLAIN_PARAGRAPHS =
	"<p>Thanks — that works.</p><p></p><p>See you then.</p>";

const UNDERLINED = "<p>Please <u>read this</u> before Friday.</p>";

const PLAIN_MARKDOWN = [
	"## Quarterly numbers",
	"",
	"| Region | Total |",
	"| --- | --- |",
	"| EMEA | 412 |",
].join("\n");

const DUTCH_DOCUMENT =
	"<p>Beste Anna, de vergadering van donderdag gaat niet door. Ik stuur je morgen een nieuw voorstel voor de planning.</p>";

const DUTCH_PROSE =
	"Beste Anna, de vergadering van donderdag gaat niet door. Ik stuur je morgen een nieuw voorstel.";

/** The languages a Dutch-writing account has configured, most-used first. */
const LANGUAGES = ["nl", "en", "de"];

const SIGNED_DOCUMENT = "<p></p><p>-- </p><p>Matthijs</p>";

const LONG_PLAIN_PROSE = [
	"Beste Anna, hierbij de planning voor volgende week zoals besproken tijdens de vergadering van donderdag.",
	"",
	"| Region | Total |",
	"| --- | --- |",
	"| EMEA | 412 |",
].join("\n");

const noop = () => undefined;

const Harness = ({
	initialHtml = "",
	initialText = "",
	startIn = "rich",
	initialCaret,
	onConversionError,
	conversions,
	languages = LANGUAGES,
	quoted,
	width = 680,
}: {
	initialHtml?: string;
	initialText?: string;
	startIn?: "rich" | "plain";
	initialCaret?: "start" | "end";
	onConversionError?: (failure: ConversionFailure) => void;
	conversions?: {
		toPlain: (value: RichTextValue) => string;
		toRich: (text: string) => string;
	};
	languages?: string[];
	quoted?: string;
	width?: number;
}) => {
	const [mode, setMode] = useState<"rich" | "plain">(startIn);
	const [failure, setFailure] = useState<ConversionFailure>();
	return (
		<div
			style={{ width }}
			className="flex h-[460px] flex-col overflow-auto rounded-md border border-line bg-canvas"
		>
			{failure && (
				<div
					role="alert"
					data-testid="compose-conversion-error"
					className="border-b border-danger/30 bg-danger-soft px-3 py-2 text-xs"
				>
					<p className="font-medium text-danger">{failure.title}</p>
					<p className="text-fg-muted">{failure.detail}</p>
				</div>
			)}
			<ComposeBody
				mode={mode}
				onModeChange={setMode}
				initialHtml={initialHtml}
				initialText={initialText}
				initialCaret={initialCaret}
				onChange={noop}
				onConversionError={(reported) => {
					setFailure(reported);
					onConversionError?.(reported);
				}}
				conversions={conversions}
				languages={languages}
				onLanguageChange={noop}
			/>
			{quoted && (
				<blockquote
					data-testid="compose-quoted"
					lang="fr"
					className="border-l-2 border-line px-3 py-2 text-sm text-fg-muted"
				>
					{quoted}
				</blockquote>
			)}
		</div>
	);
};

const chipOf = (canvasElement: HTMLElement): HTMLElement => {
	const chip = canvasElement.querySelector<HTMLElement>(
		"[data-testid=compose-language-chip]",
	);
	if (!chip) throw new Error("the language chip is not mounted");
	return chip;
};

/**
 * The mode switch as the compose window runs it: the toolbar control, the one
 * warning it raises, and the two surfaces it swaps between. The live
 * `ComposeForm` adds the recipients, the autosave and the send around this.
 */
const meta: Meta<typeof Harness> = {
	title: "Mail/ComposeBody",
	component: Harness,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof Harness>;

const toggleOf = (canvasElement: HTMLElement): HTMLElement => {
	const toggle = canvasElement.querySelector<HTMLElement>(
		"[data-testid=compose-mode-toggle]",
	);
	if (!toggle) throw new Error("the mode toggle is not mounted");
	return toggle;
};

const plainSurface = (canvasElement: HTMLElement): HTMLTextAreaElement | null =>
	canvasElement.querySelector<HTMLTextAreaElement>(
		"[data-testid=compose-body-plain]",
	);

export const RichDocument: Story = {
	name: "Rich, with formatting",
	args: { initialHtml: RICH_DOCUMENT },
};

/**
 * A new message opens above its signature. The caret used to land at the end of
 * the document, which on any account that has one put the first keystroke under
 * the sign-off.
 */
export const OpensAboveTheSignature: Story = {
	name: "A new message opens above the signature",
	args: { initialHtml: SIGNED_DOCUMENT, initialCaret: "start" },
	play: async ({ canvasElement }) => {
		const editable = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-body]",
		);
		if (!editable) throw new Error("the rich surface is not mounted");

		await waitFor(async () => {
			await expect(editable).toHaveFocus();
		});
		await userEvent.keyboard("Hoi Anna");

		await waitFor(async () => {
			const text = editable.textContent ?? "";
			await expect(text).toContain("Hoi Anna");
			await expect(text.indexOf("Hoi Anna")).toBeLessThan(
				text.indexOf("Matthijs"),
			);
		});
	},
};

/**
 * Plain prose wraps. A message whose every paragraph ran off the right edge
 * could not be read back at all, which is the worse of the two failures at 390 —
 * a pipe table wider than the surface is the one that gives.
 */
export const PlainProseWraps: Story = {
	name: "Plain, wrapping at a phone's width",
	args: { startIn: "plain", initialText: LONG_PLAIN_PROSE, width: 390 },
	play: async ({ canvasElement }) => {
		const textarea = plainSurface(canvasElement);
		if (!textarea) throw new Error("the plain surface is not mounted");
		// A pixel of tolerance: sub-pixel layout rounding, not a scrollbar.
		await expect(textarea.scrollWidth).toBeLessThanOrEqual(
			textarea.clientWidth + 1,
		);
	},
};

export const PlainDraft: Story = {
	name: "Plain, reopened from Markdown",
	args: { startIn: "plain", initialText: PLAIN_MARKDOWN },
};

/**
 * Cancel changes nothing: the mode stays rich, the document is untouched, and
 * focus comes back to the control that was pressed. `aria-pressed` never flips
 * optimistically.
 */
export const WarningCancelled: Story = {
	name: "The warning, cancelled",
	args: { initialHtml: RICH_DOCUMENT },
	play: async ({ canvasElement }) => {
		const toggle = toggleOf(canvasElement);
		await userEvent.click(toggle);

		const dialog = within(document.body).getByRole("dialog");
		await expect(dialog).toHaveTextContent("Switch to plain text?");
		await expect(dialog).toHaveTextContent(
			"Formatting becomes Markdown. Bold keeps its asterisks, a table becomes rows of pipes, and that text is what the recipient gets. No formatted version is sent alongside it.",
		);
		await expect(toggle).toHaveAttribute("aria-pressed", "false");

		await userEvent.click(
			within(dialog).getByRole("button", { name: "Cancel" }),
		);

		await expect(plainSurface(canvasElement)).toBeNull();
		await expect(
			canvasElement.querySelector("[data-testid=compose-body] table"),
		).not.toBeNull();
		await expect(toggleOf(canvasElement)).toHaveFocus();
	},
};

export const WarningConfirmed: Story = {
	name: "The warning, confirmed",
	args: { initialHtml: RICH_DOCUMENT },
	play: async ({ canvasElement }) => {
		await userEvent.click(toggleOf(canvasElement));
		await userEvent.click(
			within(within(document.body).getByRole("dialog")).getByRole("button", {
				name: "Switch to plain text",
			}),
		);

		const textarea = plainSurface(canvasElement);
		if (!textarea) throw new Error("the plain surface did not arrive");
		await expect(textarea.value).toContain("## Quarterly numbers");
		await expect(textarea.value).toContain("**up**");
		await expect(textarea.value).toContain("| EMEA | 412 |");

		// The formatting buttons leave with the rich surface.
		await expect(
			canvasElement.querySelector("[aria-label='Bold (Ctrl+B)']"),
		).toBeNull();
		await expect(toggleOf(canvasElement)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(textarea).toHaveFocus();
		await expect(textarea.selectionStart).toBe(textarea.value.length);
	},
};

/** Nothing but paragraphs and a blank line: switching changes nothing, so nothing is asked. */
export const PlainProseSwitchesSilently: Story = {
	name: "Plain paragraphs switch without asking",
	args: { initialHtml: PLAIN_PARAGRAPHS },
	play: async ({ canvasElement }) => {
		await userEvent.click(toggleOf(canvasElement));

		await expect(within(document.body).queryByRole("dialog")).toBeNull();
		const textarea = plainSurface(canvasElement);
		if (!textarea) throw new Error("the plain surface did not arrive");
		await expect(textarea.value).toContain("Thanks");
		await expect(textarea.value).toContain("See you then.");
	},
};

/**
 * An underlined word exports identical to its own characters, so a comparison
 * of the two strings would switch in silence and destroy it. The rule reads the
 * document instead.
 */
export const UnderlineStillWarns: Story = {
	name: "An underline alone still warns",
	args: { initialHtml: UNDERLINED },
	play: async ({ canvasElement }) => {
		await userEvent.click(toggleOf(canvasElement));

		await expect(within(document.body).getByRole("dialog")).toHaveTextContent(
			"Switch to plain text?",
		);
	},
};

export const PlainToRich: Story = {
	name: "Markdown back to rich, without asking",
	args: { startIn: "plain", initialText: PLAIN_MARKDOWN },
	play: async ({ canvasElement }) => {
		await userEvent.click(toggleOf(canvasElement));

		await expect(within(document.body).queryByRole("dialog")).toBeNull();
		const editable = canvasElement.querySelector("[data-testid=compose-body]");
		if (!editable) throw new Error("the rich surface did not arrive");
		await expect(editable.querySelector("h2")).not.toBeNull();
		await expect(editable.querySelector("table td")).not.toBeNull();
	},
};

/** Switching an ordinary note to rich must not reflow it. */
export const PlainProseToRich: Story = {
	name: "Prose with no Markdown in it",
	args: {
		startIn: "plain",
		initialText: "Thanks — that works.\n\nI'll send the deck tomorrow.",
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(toggleOf(canvasElement));

		const editable = canvasElement.querySelector("[data-testid=compose-body]");
		if (!editable) throw new Error("the rich surface did not arrive");
		await expect(editable.querySelectorAll("p").length).toBe(2);
		await expect(editable.textContent).toContain("Thanks — that works.");
		await expect(editable.textContent).toContain(
			"I'll send the deck tomorrow.",
		);
	},
};

/**
 * A conversion that would blank a written message does not happen: autosave
 * would persist the empty body a moment later and the draft would be gone with
 * nothing said.
 */
export const ConversionCameBackEmpty: Story = {
	name: "A conversion that came back empty",
	args: {
		startIn: "plain",
		initialText: "Everything I wrote this morning.",
		onConversionError: fn(),
		conversions: {
			toPlain: (value) => value.text,
			toRich: () => "",
		},
	},
	play: async ({ args, canvasElement }) => {
		await userEvent.click(toggleOf(canvasElement));

		await expect(args.onConversionError).toHaveBeenCalledWith({
			outcome: "blocked",
			title: "Couldn't switch to rich text",
			detail: "The conversion came back empty, so your message is unchanged.",
		});
		await expect(
			within(canvasElement).getByTestId("compose-conversion-error"),
		).toHaveTextContent("Couldn't switch to rich text");
		const textarea = plainSurface(canvasElement);
		if (!textarea) throw new Error("the plain surface left");
		await expect(textarea.value).toBe("Everything I wrote this morning.");
		await expect(toggleOf(canvasElement)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	},
};

/** One Shift+Tab out of the body reaches the toggle, and Enter acts. */
export const ReachableFromTheBody: Story = {
	name: "Shift+Tab from the body reaches it",
	args: { initialHtml: PLAIN_PARAGRAPHS },
	play: async ({ canvasElement }) => {
		const editable = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-body]",
		);
		if (!editable) throw new Error("the rich surface is not mounted");

		await userEvent.click(editable);
		await userEvent.tab({ shift: true });
		await expect(toggleOf(canvasElement)).toHaveFocus();

		await userEvent.keyboard("{Enter}");
		await expect(plainSurface(canvasElement)).not.toBeNull();
	},
};

/**
 * Detection runs over the body against the account's own languages and writes
 * the result onto the writing surface. Firefox picks a dictionary from that tag
 * among the ones the user installed; Chrome and Safari ignore it, and nothing
 * here says otherwise.
 */
export const DutchIsDetected: Story = {
	name: "Dutch prose sets the chip",
	args: { initialHtml: DUTCH_DOCUMENT },
	play: async ({ canvasElement }) => {
		await waitFor(
			async () => {
				await expect(chipOf(canvasElement)).toHaveTextContent("NL");
			},
			{ timeout: 5000 },
		);
		await expect(
			canvasElement.querySelector("[data-testid=compose-body]"),
		).toHaveAttribute("lang", "nl");
	},
};

/**
 * The account that has never opened the language setting, read on an English
 * browser. Its candidate set is the browser's answer and the dictionaries this
 * build carries — a set of one would be detection switched off, and a Dutch
 * message would keep the English tag and the English underlines.
 */
export const UnconfiguredAccountStillReadsDutch: Story = {
	name: "Dutch on an English browser, nothing configured",
	args: {
		initialHtml: DUTCH_DOCUMENT,
		languages: defaultComposeLanguages(["en-US", "en"], ["en", "en-GB", "nl"]),
	},
	play: async ({ canvasElement }) => {
		await waitFor(
			async () => {
				await expect(chipOf(canvasElement)).toHaveTextContent("NL");
			},
			{ timeout: 5000 },
		);
		await expect(
			canvasElement.querySelector("[data-testid=compose-body]"),
		).toHaveAttribute("lang", "nl");
	},
};

/** Under twenty characters detection is a coin toss, so the account default stands. */
export const TooShortHoldsTheDefault: Story = {
	name: "Nine characters hold the default",
	args: { startIn: "plain" },
	play: async ({ canvasElement }) => {
		const textarea = plainSurface(canvasElement);
		if (!textarea) throw new Error("the plain surface is not mounted");

		await userEvent.click(textarea);
		await userEvent.keyboard("Hi Sophie");

		await new Promise((resolve) => setTimeout(resolve, 800));
		await expect(chipOf(canvasElement)).toHaveTextContent("NL");
	},
};

/**
 * The first manual pick freezes the language for the rest of the message.
 * Detection does not argue with a choice the user made — a tag that moved back
 * under the caret would be a control that undoes itself.
 */
export const ManualPickSticks: Story = {
	name: "A picked language survives more typing",
	args: { startIn: "plain" },
	play: async ({ canvasElement }) => {
		const textarea = plainSurface(canvasElement);
		if (!textarea) throw new Error("the plain surface is not mounted");

		await userEvent.click(textarea);
		await userEvent.keyboard(DUTCH_PROSE);
		await waitFor(
			async () => {
				await expect(chipOf(canvasElement)).toHaveTextContent("NL");
			},
			{ timeout: 5000 },
		);

		await userEvent.click(chipOf(canvasElement));
		await userEvent.click(
			within(canvasElement).getByRole("menuitemradio", { name: /English/ }),
		);
		await expect(chipOf(canvasElement)).toHaveTextContent("EN");

		await userEvent.click(textarea);
		await userEvent.keyboard(" Groetjes, Matthijs.");
		await new Promise((resolve) => setTimeout(resolve, 800));
		await expect(chipOf(canvasElement)).toHaveTextContent("EN");
		await expect(textarea).toHaveAttribute("lang", "en");
	},
};

/**
 * Two Shift+Tabs out of the body reach the chip — one still reaches the mode
 * toggle, where #673 put it. The menu takes focus as it opens and hands it back
 * to the chip on a pick, so the keyboard never lands somewhere it cannot leave.
 */
export const ChipFromTheKeyboard: Story = {
	name: "Shift+Tab twice reaches the chip",
	// Short enough that detection declines, so the chip is on the account
	// default and the arrow key below has a known row to move off.
	args: { initialHtml: "<p>Hoi.</p>" },
	play: async ({ canvasElement }) => {
		const editable = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-body]",
		);
		if (!editable) throw new Error("the rich surface is not mounted");

		await userEvent.click(editable);
		await userEvent.tab({ shift: true });
		await expect(toggleOf(canvasElement)).toHaveFocus();
		await userEvent.tab({ shift: true });
		await expect(chipOf(canvasElement)).toHaveFocus();

		await userEvent.keyboard("{Enter}");
		await waitFor(async () => {
			await expect(
				canvasElement.querySelector("[data-testid=compose-language-menu]"),
			).not.toBeNull();
		});
		await userEvent.keyboard("{ArrowDown}{Enter}");

		await expect(chipOf(canvasElement)).toHaveTextContent("EN");
		await expect(chipOf(canvasElement)).toHaveFocus();
		await expect(editable).toHaveAttribute("lang", "en");
	},
};

/** The tag follows the message across the mode switch, onto whichever surface is up. */
export const PlainSurfaceCarriesTheLanguage: Story = {
	name: "Plain text keeps the same language",
	args: { initialHtml: DUTCH_DOCUMENT },
	play: async ({ canvasElement }) => {
		await waitFor(
			async () => {
				await expect(chipOf(canvasElement)).toHaveTextContent("NL");
			},
			{ timeout: 5000 },
		);

		await userEvent.click(toggleOf(canvasElement));
		const textarea = plainSurface(canvasElement);
		if (!textarea) throw new Error("the plain surface did not arrive");

		await expect(textarea).toHaveAttribute("lang", "nl");
		await expect(chipOf(canvasElement)).toHaveTextContent("NL");
	},
};

/**
 * The quoted block a reply is written above is somebody else's text. It lives
 * outside the editor, so detection never sees it and a French thread answered
 * in Dutch is tagged Dutch.
 */
export const QuotedTextIsNotRead: Story = {
	name: "A French quote under a Dutch reply",
	args: {
		initialHtml: DUTCH_DOCUMENT,
		quoted:
			"Bonjour, je vous confirme que la réunion de jeudi est annulée. Je vous propose de la reporter à la semaine prochaine.",
	},
	play: async ({ canvasElement }) => {
		await waitFor(
			async () => {
				await expect(chipOf(canvasElement)).toHaveTextContent("NL");
			},
			{ timeout: 5000 },
		);
		await expect(
			canvasElement.querySelector("[data-testid=compose-body]"),
		).toHaveAttribute("lang", "nl");
	},
};
