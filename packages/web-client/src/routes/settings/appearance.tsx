/**
 * Appearance settings — density and theme.
 * Instant-apply, no save button. Both settings persist in localStorage.
 *
 * Theme is driven by theme-preference.ts (setThemePreference /
 * getThemePreference) so the same preference that boots from theme.ts
 * is the one the picker shows and changes.
 */
import { SegmentedControl, SettingsShell } from "@remit/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	getThemePreference,
	setThemePreference,
	type ThemePreference,
} from "@/lib/theme-preference";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/appearance")({
	component: AppearanceSettings,
});

/* ------------------------------------------------------------------ */
/* Density helpers (local-only until user-preference storage exists)  */
/* ------------------------------------------------------------------ */

const DENSITY_KEY = "remit.density";
type Density = "comfortable" | "compact";

function readDensity(): Density {
	if (typeof localStorage === "undefined") return "comfortable";
	return (localStorage.getItem(DENSITY_KEY) as Density | null) ?? "comfortable";
}

/* ------------------------------------------------------------------ */
/* Help rail copy                                                     */
/* ------------------------------------------------------------------ */

const appearanceHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Density</strong> controls how much information
			fits on screen. Compact is great on smaller displays; Comfortable gives
			each item more breathing room.
		</p>
		<p>
			<strong className="text-fg">Theme</strong> switches between light, dark,
			and system-preference modes instantly. The change takes effect across the
			whole app immediately.
		</p>
		<p className="text-2xs text-fg-subtle">
			Preferences are stored locally in this browser. Server-side sync is coming
			soon.
		</p>
	</div>
);

/* ------------------------------------------------------------------ */
/* Page component                                                     */
/* ------------------------------------------------------------------ */

function AppearanceSettings() {
	const navigate = useNavigate();
	const [helpOpen, setHelpOpen] = useState(true);

	const [density, setDensity] = useState<Density>(readDensity);
	// Read the current stored preference so the picker reflects the boot-time value
	const [theme, setTheme] = useState<ThemePreference>(getThemePreference);

	const handleDensity = (value: Density) => {
		setDensity(value);
		// Density is read by the mail list from the same localStorage key
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(DENSITY_KEY, value);
		}
	};

	const handleTheme = (value: ThemePreference) => {
		setTheme(value);
		setThemePreference(value); // persists + applies immediately
	};

	const handleSelectNav = (id: string) => {
		const path = SETTINGS_ID_TO_PATH[id];
		if (path) void navigate({ to: path });
	};

	return (
		<SettingsShell
			items={SETTINGS_NAV_ITEMS}
			activeId="appearance"
			title="Appearance"
			description="Display density and colour theme — instant-apply."
			help={appearanceHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
			onSelect={handleSelectNav}
			onBackToMail={() => void navigate({ to: "/mail" })}
		>
			<div className="space-y-5">
				{/* Density */}
				<div className="space-y-2">
					<p className="text-sm font-medium text-fg">Density</p>
					<SegmentedControl
						name="density"
						aria-label="Density"
						value={density}
						onChange={handleDensity}
						options={[
							{ value: "comfortable", label: "Comfortable" },
							{ value: "compact", label: "Compact" },
						]}
					/>
					<p className="text-xs text-fg-subtle">
						Controls the spacing of message rows in the mail list.
					</p>
				</div>

				{/* Theme */}
				<div className="space-y-2">
					<p className="text-sm font-medium text-fg">Theme</p>
					<SegmentedControl
						name="theme"
						aria-label="Theme"
						value={theme}
						onChange={handleTheme}
						options={[
							{ value: "system", label: "System" },
							{ value: "light", label: "Light" },
							{ value: "dark", label: "Dark" },
						]}
					/>
					<p className="text-xs text-fg-subtle">
						Applies immediately. System default follows your OS preference.
					</p>
				</div>
			</div>
		</SettingsShell>
	);
}
