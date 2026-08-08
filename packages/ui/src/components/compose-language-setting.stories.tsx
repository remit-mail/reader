import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { ComposeLanguageSetting } from "./compose-language-setting.js";

const Setting = ({ initial = ["nl", "en"] }: { initial?: string[] }) => {
	const [languages, setLanguages] = useState(initial);
	return (
		<div className="w-[420px] rounded-md border border-line bg-canvas p-4">
			<ComposeLanguageSetting value={languages} onChange={setLanguages} />
		</div>
	);
};

/**
 * The account's writing languages, in settings. One list doing two jobs: the
 * menu the composer's chip offers, and the set detection chooses inside — which
 * is what keeps detection accurate on a single sentence.
 */
const meta: Meta<typeof Setting> = {
	title: "Settings/ComposeLanguages",
	component: Setting,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof Setting>;

export const TwoLanguages: Story = {
	name: "Two configured languages",
	args: {},
};

/** The last language cannot be removed: an empty list is a chip with no menu. */
export const OneLanguageCannotBeEmptied: Story = {
	name: "The last language stays",
	args: { initial: ["nl"] },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("button", { name: "Remove Nederlands" }),
		).toBeDisabled();
	},
};

export const AddingALanguage: Story = {
	name: "Adding one from the list",
	args: { initial: ["nl"] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.selectOptions(
			canvas.getByRole("combobox", { name: "Add a language" }),
			"de",
		);
		await expect(canvas.getByTestId("compose-language-row-de")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Remove Nederlands" }),
		).toBeEnabled();
	},
};

/** The first entry is what a new message opens on, and it can be moved. */
export const ChangingTheDefault: Story = {
	name: "Promoting a language to the default",
	args: { initial: ["nl", "en", "de"] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", {
				name: "Write new messages in English by default",
			}),
		);

		const rows = canvasElement.querySelectorAll(
			"[data-testid^=compose-language-row-]",
		);
		await expect(rows[0]).toHaveAttribute(
			"data-testid",
			"compose-language-row-en",
		);
		await expect(rows[0]).toHaveTextContent("Default");
	},
};
