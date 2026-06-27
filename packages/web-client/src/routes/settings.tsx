/**
 * Settings layout route — a pass-through Outlet. Each child page
 * (`/settings/accounts`, `/settings/senders`, …) renders its own
 * full-viewport `SettingsShell` from @remit/ui, exactly as the
 * approved Storybook stories do. This route only provides the route
 * boundary; no layout chrome lives here.
 *
 * Shared nav items and helpers are exported so every child page imports
 * them from this file, keeping a single source of truth for nav shape.
 */
import type { SettingsNavItem } from "@remit/ui";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { FolderTree, Inbox, Palette, Users, Wrench } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Nav items — single source of truth shared by all settings pages    */
/* ------------------------------------------------------------------ */

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
	{ id: "accounts", label: "Accounts", icon: <Inbox className="size-4" /> },
	{
		id: "senders",
		label: "Senders & Rules",
		icon: <Users className="size-4" />,
	},
	{
		id: "folders",
		label: "Folder names",
		icon: <FolderTree className="size-4" />,
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: <Palette className="size-4" />,
	},
	{ id: "advanced", label: "Advanced", icon: <Wrench className="size-4" /> },
];

export const SETTINGS_ID_TO_PATH: Record<string, string> = {
	accounts: "/settings/accounts",
	senders: "/settings/senders",
	folders: "/settings/folders",
	appearance: "/settings/appearance",
	advanced: "/settings/advanced",
};

/* ------------------------------------------------------------------ */
/* Route — pass-through                                               */
/* ------------------------------------------------------------------ */

export const Route = createFileRoute("/settings")({
	component: () => <Outlet />,
});
