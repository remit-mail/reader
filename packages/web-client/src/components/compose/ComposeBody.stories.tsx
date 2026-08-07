import type { RichTextValue } from "@remit/ui/rich-text";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ComposeBody, type ConversionFailure } from "./ComposeBody";

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

const Harness = ({
	initialHtml = "",
	initialText = "",
	startIn = "rich",
	onConversionError = () => undefined,
	conversions,
}: {
	initialHtml?: string;
	initialText?: string;
	startIn?: "rich" | "plain";
	onConversionError?: (failure: ConversionFailure) => void;
	conversions?: {
		toPlain: (value: RichTextValue) => string;
		toRich: (text: string) => string;
	};
}) => {
	const [mode, setMode] = useState<"rich" | "plain">(startIn);
	return (
		<div className="flex h-[460px] w-[680px] flex-col overflow-auto rounded-md border border-line bg-canvas">
			<ComposeBody
				mode={mode}
				onModeChange={setMode}
				initialHtml={initialHtml}
				initialText={initialText}
				onChange={() => undefined}
				onConversionError={onConversionError}
				conversions={conversions}
			/>
		</div>
	);
};

/**
 * The mode switch as the compose window runs it: the toolbar control, the one
 * warning it raises, and the two surfaces it swaps between. The live
 * `ComposeForm` adds the recipients, the autosave and the send around this.
 */
const meta: Meta<typeof Harness> = {
	title: "Screens/WebClient/ComposeModes",
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
