import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "./button.js";
import { DangerZoneSection } from "./danger-zone-section.js";
import { SegmentedControl } from "./segmented-control.js";
import { SenderGroupSwitch } from "./sender-group-switch.js";

const meta: Meta = {
	title: "Settings/Primitives",
};
export default meta;

type Story = StoryObj;

export const SegmentedControls: Story = {
	render: () => {
		const [density, setDensity] = useState("comfortable");
		const [theme, setTheme] = useState("system");
		return (
			<div className="flex flex-col gap-6 p-8">
				<SegmentedControl
					name="density"
					aria-label="Density"
					value={density}
					onChange={setDensity}
					options={[
						{ value: "comfortable", label: "Comfortable" },
						{ value: "compact", label: "Compact" },
					]}
				/>
				<SegmentedControl
					name="theme"
					aria-label="Theme"
					value={theme}
					onChange={setTheme}
					options={[
						{ value: "system", label: "System" },
						{ value: "light", label: "Light" },
						{ value: "dark", label: "Dark" },
					]}
				/>
			</div>
		);
	},
};

export const SenderGroupSwitchRail: Story = {
	render: () => {
		const [active, setActive] = useState("vip");
		return (
			<div className="flex h-96 p-8">
				<SenderGroupSwitch
					active={active}
					onSelect={setActive}
					options={[
						{ id: "vip", label: "VIPs", count: 12 },
						{ id: "muted", label: "Muted", count: null },
						{ id: "blocked", label: "Blocked", count: null },
					]}
				/>
			</div>
		);
	},
};

export const DangerZone: Story = {
	render: () => (
		<div className="max-w-2xl p-8">
			<DangerZoneSection
				title="Delete your Remit account"
				description="Disconnects every account and erases Remit's copy of your mail, insights and preferences. Your mail at the providers is untouched."
				action={
					<Button variant="danger" size="sm">
						Delete your Remit account
					</Button>
				}
			/>
		</div>
	),
};
