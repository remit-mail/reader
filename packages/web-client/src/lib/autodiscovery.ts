/**
 * Client-side autodiscovery for IMAP/SMTP server settings.
 *
 * Strategy (stop at first hit):
 * 1. Curated provider table (top ~30 providers)
 * 2. Mozilla Autoconfig: GET https://autoconfig.thunderbird.net/v1.1/{domain}
 * 3. Domain-hosted autoconfig: GET https://autoconfig.{domain}/mail/config-v1.1.xml
 * 4. Fallback heuristics: imap.{domain}:993/tls, smtp.{domain}:587/starttls
 *
 * NOTE: A future backend endpoint `GET /autodiscovery?email=…` (TypeSpec-first)
 * is planned to handle DNS SRV lookups and CORS-blocked domains server-side.
 * Until it exists, this client-side implementation covers the majority of providers.
 */

export type SecurityMode = "tls" | "starttls" | "none";

export interface ServerSettings {
	host: string;
	port: number;
	security: SecurityMode;
}

export interface DiscoveryResult {
	imap: ServerSettings;
	smtp: ServerSettings;
	/** Source of the discovery result */
	source:
		| "provider-table"
		| "mozilla-autoconfig"
		| "domain-autoconfig"
		| "heuristic";
}

/** Static curated provider table — top providers with known-good settings */
const PROVIDER_TABLE: Record<string, DiscoveryResult> = {
	"gmail.com": {
		imap: { host: "imap.gmail.com", port: 993, security: "tls" },
		smtp: { host: "smtp.gmail.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"googlemail.com": {
		imap: { host: "imap.gmail.com", port: 993, security: "tls" },
		smtp: { host: "smtp.gmail.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"outlook.com": {
		imap: { host: "outlook.office365.com", port: 993, security: "tls" },
		smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"hotmail.com": {
		imap: { host: "outlook.office365.com", port: 993, security: "tls" },
		smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"live.com": {
		imap: { host: "outlook.office365.com", port: 993, security: "tls" },
		smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"msn.com": {
		imap: { host: "outlook.office365.com", port: 993, security: "tls" },
		smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"icloud.com": {
		imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"me.com": {
		imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"mac.com": {
		imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"fastmail.com": {
		imap: { host: "imap.fastmail.com", port: 993, security: "tls" },
		smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"fastmail.fm": {
		imap: { host: "imap.fastmail.com", port: 993, security: "tls" },
		smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"yahoo.com": {
		imap: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"yahoo.co.uk": {
		imap: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"ymail.com": {
		imap: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	// NOTE: ProtonMail is intentionally omitted from the provider table.
	// Proton has no direct IMAP/SMTP for hosted clients — it requires the
	// locally-run Proton Bridge (127.0.0.1). Remit syncs server-side, so a
	// loopback host would resolve to the sync worker, never the user's
	// machine. Proton accounts fall through to manual entry, where the user
	// can point at their own Bridge/relay if they run one.
	"aol.com": {
		imap: { host: "imap.aol.com", port: 993, security: "tls" },
		smtp: { host: "smtp.aol.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"zoho.com": {
		imap: { host: "imap.zoho.com", port: 993, security: "tls" },
		smtp: { host: "smtp.zoho.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"gmx.com": {
		imap: { host: "imap.gmx.com", port: 993, security: "tls" },
		smtp: { host: "smtp.gmx.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"gmx.net": {
		imap: { host: "imap.gmx.net", port: 993, security: "tls" },
		smtp: { host: "mail.gmx.net", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"gmx.de": {
		imap: { host: "imap.gmx.net", port: 993, security: "tls" },
		smtp: { host: "mail.gmx.net", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"web.de": {
		imap: { host: "imap.web.de", port: 993, security: "tls" },
		smtp: { host: "smtp.web.de", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"mail.com": {
		imap: { host: "imap.mail.com", port: 993, security: "tls" },
		smtp: { host: "smtp.mail.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"hey.com": {
		imap: { host: "imap.hey.com", port: 993, security: "tls" },
		smtp: { host: "smtp.hey.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"tutanota.com": {
		imap: { host: "mail.tutanota.com", port: 993, security: "tls" },
		smtp: { host: "mail.tutanota.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"tuta.io": {
		imap: { host: "mail.tutanota.com", port: 993, security: "tls" },
		smtp: { host: "mail.tutanota.com", port: 465, security: "tls" },
		source: "provider-table",
	},
	"posteo.de": {
		imap: { host: "posteo.de", port: 993, security: "tls" },
		smtp: { host: "posteo.de", port: 465, security: "tls" },
		source: "provider-table",
	},
	"runbox.com": {
		imap: { host: "imap.runbox.com", port: 993, security: "tls" },
		smtp: { host: "smtp.runbox.com", port: 587, security: "starttls" },
		source: "provider-table",
	},
	"mailbox.org": {
		imap: { host: "imap.mailbox.org", port: 993, security: "tls" },
		smtp: { host: "smtp.mailbox.org", port: 465, security: "tls" },
		source: "provider-table",
	},
	"hushmail.com": {
		imap: { host: "imap.hushmail.com", port: 993, security: "tls" },
		smtp: { host: "smtp.hushmail.com", port: 465, security: "tls" },
		source: "provider-table",
	},
};

/** App-password doc links per domain (static lookup) */
export const APP_PASSWORD_URLS: Record<string, string> = {
	"gmail.com": "https://support.google.com/accounts/answer/185833",
	"googlemail.com": "https://support.google.com/accounts/answer/185833",
	"yahoo.com":
		"https://help.yahoo.com/kb/generate-manage-third-party-passwords-sln15241.html",
	"icloud.com": "https://support.apple.com/en-us/102654",
	"me.com": "https://support.apple.com/en-us/102654",
	"mac.com": "https://support.apple.com/en-us/102654",
	"fastmail.com": "https://www.fastmail.help/hc/en-us/articles/360058752854",
	"fastmail.fm": "https://www.fastmail.help/hc/en-us/articles/360058752854",
	"outlook.com":
		"https://support.microsoft.com/en-us/account-billing/manage-app-passwords-for-two-step-verification-d6dc8c6d-4bf7-4851-ad95-6d07799387e9",
	"hotmail.com":
		"https://support.microsoft.com/en-us/account-billing/manage-app-passwords-for-two-step-verification-d6dc8c6d-4bf7-4851-ad95-6d07799387e9",
	"zoho.com":
		"https://help.zoho.com/portal/en/kb/zoho-mail/client-configuration/imap-access/articles/zoho-mail-app-passwords",
};

function parseMozillaAutoconfigXml(xml: string): DiscoveryResult | null {
	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xml, "application/xml");
		if (doc.querySelector("parsererror")) return null;

		const incomingServers = doc.querySelectorAll("incomingServer[type='imap']");
		const outgoingServers = doc.querySelectorAll("outgoingServer[type='smtp']");

		if (!incomingServers.length || !outgoingServers.length) return null;

		const imap = incomingServers[0];
		const smtp = outgoingServers[0];

		const imapHost = imap.querySelector("hostname")?.textContent?.trim();
		const imapPortStr = imap.querySelector("port")?.textContent?.trim();
		const imapSocketType = imap
			.querySelector("socketType")
			?.textContent?.trim()
			.toUpperCase();

		const smtpHost = smtp.querySelector("hostname")?.textContent?.trim();
		const smtpPortStr = smtp.querySelector("port")?.textContent?.trim();
		const smtpSocketType = smtp
			.querySelector("socketType")
			?.textContent?.trim()
			.toUpperCase();

		if (!imapHost || !imapPortStr || !smtpHost || !smtpPortStr) return null;

		const socketToSecurity = (socket: string | undefined): SecurityMode => {
			if (socket === "SSL" || socket === "TLS" || socket === "SSL/TLS")
				return "tls";
			if (socket === "STARTTLS") return "starttls";
			return "none";
		};

		return {
			imap: {
				host: imapHost,
				port: Number.parseInt(imapPortStr, 10),
				security: socketToSecurity(imapSocketType),
			},
			smtp: {
				host: smtpHost,
				port: Number.parseInt(smtpPortStr, 10),
				security: socketToSecurity(smtpSocketType),
			},
			source: "mozilla-autoconfig",
		};
	} catch {
		return null;
	}
}

async function fetchMozillaAutoconfig(
	domain: string,
	signal: AbortSignal,
): Promise<DiscoveryResult | null> {
	try {
		const url = `https://autoconfig.thunderbird.net/v1.1/${domain}`;
		const res = await fetch(url, { signal });
		if (!res.ok) return null;
		const xml = await res.text();
		const result = parseMozillaAutoconfigXml(xml);
		if (result) return result;
		return null;
	} catch {
		return null;
	}
}

async function fetchDomainAutoconfig(
	domain: string,
	signal: AbortSignal,
): Promise<DiscoveryResult | null> {
	try {
		const url = `https://autoconfig.${domain}/mail/config-v1.1.xml`;
		const res = await fetch(url, { signal });
		if (!res.ok) return null;
		const xml = await res.text();
		const result = parseMozillaAutoconfigXml(xml);
		if (result) return { ...result, source: "domain-autoconfig" };
		return null;
	} catch {
		return null;
	}
}

function heuristicResult(domain: string): DiscoveryResult {
	return {
		imap: { host: `imap.${domain}`, port: 993, security: "tls" },
		smtp: { host: `smtp.${domain}`, port: 587, security: "starttls" },
		source: "heuristic",
	};
}

/**
 * Run autodiscovery for the given email address.
 * Returns null if discovery fails after all strategies; caller should show manual-entry UI.
 *
 * Timeout defaults to 1.5s (not the spec's 5s): the browser autoconfig
 * fetches (Mozilla ISPDB + autoconfig.{domain}) almost always reject on CORS,
 * so for any non-table domain we'd otherwise burn ~5s on two doomed requests
 * before the heuristic fallback. A short budget keeps the address step snappy.
 * The real fix is the backend `/autodiscovery` endpoint (see module header).
 */
export async function discoverSettings(
	email: string,
	timeoutMs = 1500,
): Promise<DiscoveryResult | null> {
	const atIdx = email.indexOf("@");
	if (atIdx === -1) return null;
	const domain = email.slice(atIdx + 1).toLowerCase();
	if (!domain) return null;

	// 1. Curated table — instant, no network
	const tableResult = PROVIDER_TABLE[domain];
	if (tableResult) return tableResult;

	// 2+3. Network lookups with timeout
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const mozilla = await fetchMozillaAutoconfig(domain, controller.signal);
		if (mozilla) return mozilla;

		const domainConfig = await fetchDomainAutoconfig(domain, controller.signal);
		if (domainConfig) return domainConfig;
	} finally {
		clearTimeout(timer);
	}

	// 4. Heuristic fallback — caller decides whether to prefill or show manual
	return heuristicResult(domain);
}

/** Get a human-readable "looking up …" message shown during autodiscovery */
export function getDiscoveryStatusMessage(email: string): string {
	const atIdx = email.indexOf("@");
	if (atIdx === -1) return "Looking up server settings…";
	const domain = email.slice(atIdx + 1);
	return `Looking up settings for ${domain}…`;
}

/** Get app-password URL for the email's domain, if known */
export function getAppPasswordUrl(email: string): string | undefined {
	const atIdx = email.indexOf("@");
	if (atIdx === -1) return undefined;
	const domain = email.slice(atIdx + 1).toLowerCase();
	return APP_PASSWORD_URLS[domain];
}
