import { SettingsShell } from "@remit/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { WarningsPanel } from "@/components/settings/WarningsPanel";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";
import { warningsHelp } from "./-shared/help-copy";

export const Route = createFileRoute("/settings/warnings")({
	component: WarningsSettings,
});

function WarningsSettings() {
	const navigate = useNavigate();
	const [helpOpen, setHelpOpen] = useState(true);

	const handleSelectNav = (id: string) => {
		const path = SETTINGS_ID_TO_PATH[id];
		if (path) void navigate({ to: path });
	};

	return (
		<SettingsShell
			items={SETTINGS_NAV_ITEMS}
			activeId="warnings"
			title="Warnings"
			description="Messages that failed to sync, and messages set aside."
			help={warningsHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
			onSelect={handleSelectNav}
			onBackToMail={() => void navigate({ to: "/mail" })}
		>
			<WarningsPanel />
		</SettingsShell>
	);
}
