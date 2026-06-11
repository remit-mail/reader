/**
 * Advanced settings — stub page. Notification rules, export, and
 * diagnostics are future scope; this keeps the nav item from 404-ing.
 */
import { SettingsShell } from "@remit/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/advanced")({
	component: AdvancedSettings,
});

const advancedHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Notification rules</strong>, data export, and
			per-account diagnostics are coming in a future release.
		</p>
	</div>
);

function AdvancedSettings() {
	const navigate = useNavigate();
	const [helpOpen, setHelpOpen] = useState(true);

	const handleSelectNav = (id: string) => {
		const path = SETTINGS_ID_TO_PATH[id];
		if (path) void navigate({ to: path });
	};

	return (
		<SettingsShell
			items={SETTINGS_NAV_ITEMS}
			activeId="advanced"
			title="Advanced"
			description="Notification rules, export, and diagnostics."
			help={advancedHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
			onSelect={handleSelectNav}
		>
			<p className="text-sm text-fg-muted">
				Advanced options — notification rules, data export, and raw sync
				diagnostics — are coming in a future release.
			</p>
		</SettingsShell>
	);
}
