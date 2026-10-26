import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { after, describe, it } from "node:test";
import type { ImapTransport } from "imapflow";
import { testImapConnection } from "./connection-test.js";
import { nodeTransport } from "./node-transport.js";

const servers: Server[] = [];
const sockets: Socket[] = [];

after(() => {
	for (const socket of sockets) socket.destroy();
	for (const server of servers) server.close();
});

const imapServer = (login: "OK" | "NO"): Promise<number> =>
	new Promise((resolve) => {
		const server = createServer((socket) => {
			sockets.push(socket);
			socket.on("error", () => {});
			socket.write("* OK [CAPABILITY IMAP4rev1] ready\r\n");
			let buffered = "";
			socket.on("data", (chunk) => {
				buffered += chunk.toString();
				let end = buffered.indexOf("\r\n");
				while (end !== -1) {
					const [tag, command] = buffered.slice(0, end).split(" ");
					buffered = buffered.slice(end + 2);
					const verb = command?.toUpperCase();
					if (verb === "CAPABILITY") {
						socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
					} else if (verb === "LOGIN" && login === "OK") {
						socket.write(`${tag} OK logged in\r\n`);
					} else if (verb === "LOGIN") {
						socket.write(`${tag} NO [AUTHENTICATIONFAILED] bad password\r\n`);
					} else if (verb === "LOGOUT") {
						socket.end(`* BYE\r\n${tag} OK bye\r\n`);
					} else {
						socket.write(`${tag} OK done\r\n`);
					}
					end = buffered.indexOf("\r\n");
				}
			});
		});
		servers.push(server);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve(typeof address === "object" && address ? address.port : 0);
		});
	});

const recordingTransport = (opened: number[]): ImapTransport => {
	const node = nodeTransport();
	return {
		...node,
		connect: (options, onConnect) => {
			opened.push(options.port);
			return node.connect(options, onConnect);
		},
	};
};

const config = (port: number) => ({
	host: "127.0.0.1",
	port,
	secure: false,
	user: "alice@example.com",
	credentials: { kind: "password" as const, password: "s3cr3t" },
});

describe("testImapConnection", () => {
	it("signs in over the injected transport", async () => {
		const port = await imapServer("OK");
		const opened: number[] = [];

		const result = await testImapConnection(
			config(port),
			recordingTransport(opened),
		);

		assert.deepEqual(result, { success: true });
		assert.deepEqual(opened, [port]);
	});

	it("reports a refused login as an authentication failure", async () => {
		const port = await imapServer("NO");

		const result = await testImapConnection(config(port), nodeTransport());

		assert.equal(result.success, false);
		assert.match(result.success ? "" : result.error, /authentication failed/i);
	});
});
