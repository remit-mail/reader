/**
 * Advanced settings. Updates live here — and only here — with a full pane in
 * Settings › Advanced, alongside the messages sync could not read. Notification
 * rules and export are future scope.
 */
import { SettingsShell } from "@remit/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { QuarantinePanel } from "@/components/settings/QuarantinePanel";
import { SelfUpdatePanel } from "@/components/settings/SelfUpdatePanel";
import { TlsRootCaDownload } from "@/components/settings/TlsRootCaDownload";
import { AppVersion } from "@/components/ui/AppVersion";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/advanced")({
	component: AdvancedSettings,
});

const advancedHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Notification rules</strong> and data export
			are coming in a future release.
		</p>
		<p>
			A message Remit cannot read is{" "}
			<strong className="text-fg">set aside</strong> rather than skipped, and
			the folder keeps syncing. Setting one aside is a defect in Remit, so every
			entry can be reported with the diagnostics already attached.
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
			onBackToMail={() => void navigate({ to: "/mail" })}
		>
			<SelfUpdatePanel />
			<QuarantinePanel />
			<div className="mt-6 border-t border-line pt-4">
				<p className="text-sm text-fg-muted">
					Notification rules and data export are coming in a future release.
				</p>
			</div>
			<TlsRootCaDownload />
			<div className="border-t border-line pt-4 mt-4">
				<p className="text-sm font-medium text-fg mb-1">About</p>
				<AppVersion />
			</div>
		</SettingsShell>
	);
}
