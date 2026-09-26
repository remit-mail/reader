import type { AccountService } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { StepMicrosoftEmail } from "./onboarding.js";

const meta: Meta = {
	title: "Playground/Proposed/Onboarding",
	tags: ["proposed"],
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * Microsoft sign-in sub-step (#1178). The connector tile sits on top, the
 * service choice under it and the optional email prefill under that — the pick
 * is made before the redirect, so the consent screen asks for the scopes it
 * matches. Both services on is the default, and the copy under the rows says
 * adding a service later is another sign-in with Microsoft.
 */
export const MicrosoftEmail: Story = {
	render: () => <StepMicrosoftEmail />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("checkbox", { name: /Mail/ })).toBeChecked();
		await expect(
			canvas.getByRole("checkbox", { name: /Calendar/ }),
		).toBeChecked();
	},
};

/**
 * Handing off to Microsoft is a redirect, so the story stands in for it: once
 * the step calls onNext the window is gone.
 */
function MicrosoftHandoff({
	initialServices,
	offered,
}: {
	initialServices?: AccountService[];
	offered?: AccountService[];
}) {
	const [handedOff, setHandedOff] = useState(false);
	if (handedOff) {
		return (
			<div data-testid="microsoft-redirect" className="p-6 text-sm text-fg">
				Redirecting to Microsoft…
			</div>
		);
	}
	return (
		<StepMicrosoftEmail
			initialServices={initialServices}
			offered={offered}
			onNext={() => setHandedOff(true)}
		/>
	);
}

/**
 * Neither service ticked. Continue stays live and says what is missing rather
 * than going dead, and it does not hand an empty set to the provider — the
 * account endpoints refuse one.
 */
export const MicrosoftNeitherServiceSelected: Story = {
	render: () => <MicrosoftHandoff initialServices={[]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Pick at least one",
		);
		await expect(canvas.queryByTestId("microsoft-redirect")).toBeNull();

		await userEvent.click(canvas.getByRole("checkbox", { name: /Calendar/ }));
		await userEvent.click(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		);
		await expect(canvas.getByTestId("microsoft-redirect")).toBeVisible();
	},
};

/**
 * A connector that carries mail alone — IMAP today. There is nothing to
 * choose, so no choice appears between the tile and the email field: absent,
 * not a disabled row.
 */
export const MicrosoftMailOnlyProvider: Story = {
	render: () => <StepMicrosoftEmail offered={["Mail"]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByText("What should Remit sync?")).toBeNull();
		await expect(canvas.queryAllByRole("checkbox")).toHaveLength(0);
	},
};

/**
 * A mail-only connector arriving with nothing picked. There are no rows to
 * show, so the refusal stands on its own — the button says what is wrong
 * instead of doing nothing.
 */
export const MicrosoftMailOnlyProviderRefused: Story = {
	render: () => <MicrosoftHandoff offered={["Mail"]} initialServices={[]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Pick at least one",
		);
		await expect(canvas.queryByTestId("microsoft-redirect")).toBeNull();
	},
};

/**
 * The same step inside Settings → Accounts → "Add account", which mounts the
 * wizard in a full-screen overlay from the connector picker. Back still goes to
 * the connector, in both hosts — leaving is done on the picker.
 */
export const MicrosoftServiceChoiceInSettings: Story = {
	render: () => (
		<div className="fixed inset-0 z-40 overflow-auto bg-canvas">
			<StepMicrosoftEmail />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("button", { name: "Back" })).toBeVisible();
	},
};
