import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { ComposeLanguageChip } from "./compose-language-chip.js";

const LANGUAGES = ["nl", "en", "de"];

const CHROME_HELP =
	"Chrome checks every language you add under Settings, then Languages. Adding one there checks it alongside the others.";
const SAFARI_HELP =
	"macOS decides this under Keyboard, then Text Input, then Spelling. Automatic by Language covers every language enabled there.";
const FIREFOX_HELP =
	"Firefox uses this setting. Right-click the message to add a dictionary for it.";

const Chip = ({
	initial = "nl",
	helpText,
}: {
	initial?: string;
	helpText?: string;
}) => {
	const [language, setLanguage] = useState(initial);
	return (
		<div className="flex w-[360px] justify-end rounded-md border border-line bg-canvas p-2">
			<ComposeLanguageChip
				language={language}
				languages={LANGUAGES}
				onSelect={setLanguage}
				helpText={helpText}
			/>
		</div>
	);
};

/**
 * The language control at the right of the compose toolbar. Two letters, the
 * language in full to a screen reader, and a menu of the account's languages
 * over one sentence naming the browser setting that actually fixes spelling.
 *
 * The sentence is the only part of this feature that fixes anything for a
 * Chrome or Safari user, and it says whose setting it is.
 */
const meta: Meta<typeof Chip> = {
	title: "Mail/ComposeLanguageChip",
	component: Chip,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof Chip>;

export const Closed: Story = {
	name: "The chip",
	args: {},
};

const openMenu = async (canvasElement: HTMLElement): Promise<void> => {
	await userEvent.click(
		within(canvasElement).getByRole("button", {
			name: /^Message language:/,
		}),
	);
};

export const MenuOnChrome: Story = {
	name: "Open, on Chrome",
	args: { helpText: CHROME_HELP },
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await expect(
			within(canvasElement).getByTestId("compose-language-help"),
		).toHaveTextContent(CHROME_HELP);
	},
};

export const MenuOnSafari: Story = {
	name: "Open, on Safari",
	args: { helpText: SAFARI_HELP },
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await expect(
			within(canvasElement).getByTestId("compose-language-help"),
		).toHaveTextContent(SAFARI_HELP);
	},
};

export const MenuOnFirefox: Story = {
	name: "Open, on Firefox",
	args: { helpText: FIREFOX_HELP },
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await expect(
			within(canvasElement).getByTestId("compose-language-help"),
		).toHaveTextContent(FIREFOX_HELP);
	},
};

/**
 * Each row is a radio: the current language is the checked one, and every row
 * carries its own `lang`, so a screen reader reads `Nederlands` in Dutch rather
 * than sounding it out in the reader's own voice.
 */
export const MenuMarksTheCurrentLanguage: Story = {
	name: "The current language is checked",
	args: { initial: "de", helpText: CHROME_HELP },
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		const canvas = within(canvasElement);

		await expect(
			canvas.getByRole("menuitemradio", { name: /Deutsch/ }),
		).toHaveAttribute("aria-checked", "true");
		await expect(
			canvas.getByRole("menuitemradio", { name: /Nederlands/ }),
		).toHaveAttribute("aria-checked", "false");
	},
};

/** Escape leaves without changing anything, and hands focus back to the chip. */
export const EscapeReturnsFocus: Story = {
	name: "Escape closes and returns focus",
	args: { helpText: CHROME_HELP },
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await userEvent.keyboard("{Escape}");

		await expect(
			within(canvasElement).queryByTestId("compose-language-menu"),
		).toBeNull();
		const chip = within(canvasElement).getByRole("button", {
			name: /^Message language:/,
		});
		await expect(chip).toHaveFocus();
		await expect(chip).toHaveTextContent("NL");
	},
};
