import type { ServerSettings } from "./autodiscovery.js";

export interface ProviderPreset {
	id: string;
	label: string;
	username: "full-email";
	imap: ServerSettings;
	smtp: ServerSettings;
	passwordHelp: { text: string; url: string };
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		id: "icloud",
		label: "iCloud",
		username: "full-email",
		imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
		passwordHelp: {
			text: "iCloud requires an app-specific password, not your Apple ID password. Generate one under Sign-In & Security → App-Specific Passwords.",
			url: "https://support.apple.com/en-us/102654",
		},
	},
	{
		id: "yahoo",
		label: "Yahoo",
		username: "full-email",
		imap: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
		passwordHelp: {
			text: "Yahoo requires an app password, not your login password. Generate one under Account Security.",
			url: "https://help.yahoo.com/kb/generate-manage-third-party-passwords-sln15241.html",
		},
	},
	{
		id: "aol",
		label: "AOL",
		username: "full-email",
		imap: { host: "imap.aol.com", port: 993, security: "tls" },
		smtp: { host: "smtp.aol.com", port: 465, security: "tls" },
		passwordHelp: {
			text: "AOL requires an app password, not your login password. Generate one under Account Security.",
			url: "https://login.aol.com/account/security",
		},
	},
	{
		id: "fastmail",
		label: "Fastmail",
		username: "full-email",
		imap: { host: "imap.fastmail.com", port: 993, security: "tls" },
		smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" },
		passwordHelp: {
			text: "Fastmail requires an app password, not your login password. Create one under Settings → Privacy & Security → App passwords.",
			url: "https://www.fastmail.help/hc/en-us/articles/360058752854",
		},
	},
];

export function getPresetById(id: string): ProviderPreset | undefined {
	return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

const DOMAIN_TO_PRESET: Record<string, string> = {
	"icloud.com": "icloud",
	"me.com": "icloud",
	"mac.com": "icloud",
	"yahoo.com": "yahoo",
	"yahoo.co.uk": "yahoo",
	"ymail.com": "yahoo",
	"aol.com": "aol",
	"fastmail.com": "fastmail",
	"fastmail.fm": "fastmail",
};

/** Pre-select a provider preset from a known email domain; "" for Custom. */
export function presetIdForEmail(email: string): string {
	const atIdx = email.indexOf("@");
	if (atIdx === -1) return "";
	const domain = email.slice(atIdx + 1).toLowerCase();
	return DOMAIN_TO_PRESET[domain] ?? "";
}
