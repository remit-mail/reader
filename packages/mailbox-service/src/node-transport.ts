import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { ImapTransport } from "imapflow";

const sni = (servername: string | undefined): { servername?: string } =>
	servername ? { servername } : {};

export const nodeTransport = (): ImapTransport => ({
	connect: ({ host, port, servername, tls, secure }, onConnect) =>
		secure
			? tlsConnect({ host, port, ...sni(servername), ...tls }, onConnect)
			: netConnect({ host, port }, onConnect),
	upgrade: (socket, { host, port, servername, tls }, onSecure) =>
		tlsConnect({ socket, host, port, ...sni(servername), ...tls }, onSecure),
});
