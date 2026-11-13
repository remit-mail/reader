import type { SpamRequest } from "@remit/data-ports";

type SpamHeader = SpamRequest["message"]["headers"][number];
type Hop = Pick<SpamRequest["envelope"], "ip" | "helo" | "hostname">;

const NO_HOP: Hop = { ip: "", helo: "", hostname: "" };

const RECEIVED_FROM = /^from\s+(\S+)\s+\(([^)]*)\)/i;
const BRACKETED_IP = /\[(?:ipv6:)?([0-9a-f.:]+)\]/i;
const EXIM_HELO = /helo=([^\s)\]]+)/i;
const NAME_BEFORE_IP = /^([^\s[]+)\s*\[/;
const JUDGED_IP = [
	/client-ip=([0-9a-f.:]+)/i,
	/sender IP is ([0-9a-f.:]+)/i,
	/designates ([0-9a-f.:]+) as permitted sender/i,
	/policy\.iprev=([0-9a-f.:]+)/i,
];

const hostnameOf = (name: string | undefined): string => {
	const host = (name ?? "").replace(/\.$/, "").toLowerCase();
	return host === "unknown" ? "" : host;
};

const hopOf = (received: string): Hop | undefined => {
	const from = RECEIVED_FROM.exec(received.trim());
	if (!from) return undefined;
	const [, first, comment] = from;
	const ip = BRACKETED_IP.exec(comment)?.[1]?.toLowerCase();
	if (!ip) return undefined;
	const exim = EXIM_HELO.exec(comment);
	if (exim) return { ip, helo: exim[1], hostname: hostnameOf(first) };
	return {
		ip,
		helo: first,
		hostname: hostnameOf(NAME_BEFORE_IP.exec(comment.trim())?.[1]),
	};
};

const firstValue = (headers: readonly SpamHeader[], name: string) =>
	headers.find((header) => header.name.toLowerCase() === name)?.value ?? "";

const judgedIp = (headers: readonly SpamHeader[]): string | undefined => {
	const evidence = `${firstValue(headers, "received-spf")} ${firstValue(headers, "authentication-results")}`;
	for (const pattern of JUDGED_IP) {
		const ip = pattern.exec(evidence)?.[1];
		if (ip) return ip.toLowerCase();
	}
	return undefined;
};

const isPublicIp = (ip: string): boolean => {
	const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
	const octets = v4.split(".").map(Number);
	if (octets.length === 4) {
		const [a, b] = octets;
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168)
		);
	}
	return !(ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip));
};

/**
 * The server that handed the message to the provider. Received headers stack
 * newest first, and the provider's own relays sit on top, so the top hop is
 * the provider talking to itself. The provider's SPF check names the IP it
 * judged; that hop is the sending server. Without one, the first hop from a
 * public address stands in, which skips internal relays on private networks.
 */
export const sendingHop = (headers: readonly SpamHeader[]): Hop => {
	const hops = headers
		.filter((header) => header.name.toLowerCase() === "received")
		.flatMap((header) => hopOf(header.value) ?? []);
	const judged = judgedIp(headers);
	return (
		hops.find((hop) => hop.ip === judged) ??
		hops.find((hop) => isPublicIp(hop.ip)) ??
		NO_HOP
	);
};
