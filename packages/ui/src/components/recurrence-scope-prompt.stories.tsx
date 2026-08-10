import type { Meta, StoryObj } from "@storybook/react-vite";
import { RecurrenceScopePrompt } from "./recurrence-scope-prompt.js";

/**
 * The scope question, asked before the form opens. Editing one instance and
 * editing the rule are different acts, so the choice is made while the change
 * is still an intention.
 */
const meta: Meta<typeof RecurrenceScopePrompt> = {
	title: "Calendar/Recurrence scope",
	component: RecurrenceScopePrompt,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof RecurrenceScopePrompt>;

export const Desktop: Story = {
	render: () => (
		<div className="max-w-sm rounded-lg border border-line bg-surface-raised p-4">
			<RecurrenceScopePrompt
				title="Standup"
				ruleText="Every weekday, 09:15"
				instanceText="Wednesday 10 June"
				onChoose={() => {}}
				onCancel={() => {}}
			/>
		</div>
	),
};

/** The same question with thumb-sized targets. */
export const Touch: Story = {
	render: () => (
		<div className="max-w-sm rounded-lg border border-line bg-surface-raised p-4">
			<RecurrenceScopePrompt
				title="Standup"
				ruleText="Every weekday, 09:15"
				instanceText="Wednesday 10 June"
				onChoose={() => {}}
				onCancel={() => {}}
				touch
			/>
		</div>
	),
};
