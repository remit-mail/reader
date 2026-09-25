import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { getPresetById } from "@/lib/provider-presets";
import { StepServers } from "./OnboardingWizard";

const gmail = getPresetById("gmail");
if (!gmail) throw new Error("the gmail preset is missing");

const meta: Meta<typeof StepServers> = {
	title: "Flows/Onboarding/Servers",
	component: StepServers,
	parameters: { layout: "fullscreen" },
	args: {
		email: "alice@gmail.com",
		imapConfig: gmail.imap,
		smtpConfig: gmail.smtp,
		discovered: true,
		onContinue: () => {},
		onBack: () => {},
		onChange: () => {},
	},
};
export default meta;

type Story = StoryObj<typeof StepServers>;

export const GmailPreset: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByLabelText("Provider")).toHaveValue("gmail");
		await expect(canvas.getByDisplayValue("imap.gmail.com")).toHaveAttribute(
			"readonly",
		);
		await expect(canvas.getByDisplayValue("smtp.gmail.com")).toHaveAttribute(
			"readonly",
		);
		await expect(canvas.getByText(/2-Step Verification/)).toBeVisible();
		await expect(
			canvas.getByRole("link", { name: "Get an app password" }),
		).toHaveAttribute("href", gmail.passwordHelp.url);
	},
};

export const GmailPresetPhone: Story = {
	globals: { viewport: { value: "mobile" } },
};
