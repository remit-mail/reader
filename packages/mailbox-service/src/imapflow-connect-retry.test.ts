import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { after, describe, it } from "node:test";
import { ImapFlowConnection } from "./imapflow-connection.js";
import { MailConnectionError } from "./types.js";

const servers: Server[] = [];
const sockets: Socket[] = [];

after(() => {
	for (const socket of sockets) socket.destroy();
	for (const server of servers) server.close();
});

const listen = (server: Server): Promise<number> =>
	new Promise((resolve) => {
		servers.push(server);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve(typeof address === "object" && address ? address.port : 0);
		});
	});

const refusingLogin = async (refusal: string) => {
	const state = { connections: 0 };
	const server = createServer((socket) => {
		state.connections++;
		sockets.push(socket);
		socket.write("* OK [CAPABILITY IMAP4rev1] ready\r\n");
		let buffered = "";
		socket.on("data", (chunk) => {
			buffered += chunk.toString();
			let end = buffered.indexOf("\r\n");
			while (end !== -1) {
				const line = buffered.slice(0, end);
				buffered = buffered.slice(end + 2);
				const [tag, command] = line.split(" ");
				const verb = command?.toUpperCase();
				if (verb === "CAPABILITY") {
					socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
				} else if (verb === "LOGIN") {
					socket.write(`${tag} NO [AUTHENTICATIONFAILED] ${refusal}\r\n`);
				} else if (verb === "LOGOUT") {
					socket.end(`* BYE\r\n${tag} OK bye\r\n`);
				} else {
					socket.write(`${tag} BAD unknown\r\n`);
				}
				end = buffered.indexOf("\r\n");
			}
		});
		socket.on("error", () => {});
	});
	return { port: await listen(server), state };
};

const closedPort = async (): Promise<number> => {
	const server = createServer();
	const port = await listen(server);
	await new Promise((resolve) => server.close(resolve));
	return port;
};

const connectTo = (port: number) =>
	new ImapFlowConnection({
		host: "127.0.0.1",
		port,
		user: "alice@example.com",
		credentials: { kind: "password", password: "s3cr3t" },
		tls: false,
	}).connect();

describe("ImapFlowConnection.connect() retry policy", () => {
	it("retries a refused connection, then names the endpoint in a network error", async () => {
		const port = await closedPort();

		await assert.rejects(connectTo(port), (error: unknown) => {
			assert.ok(error instanceof MailConnectionError);
			assert.equal(error.kind, "network");
			assert.match(error.message, new RegExp(`127\\.0\\.0\\.1:${port}`));
			return true;
		});
	});

	it("does not retry a refused login and carries the server's own words", async () => {
		const { port, state } = await refusingLogin(
			"LOGIN failed. SmtpClientAuthentication is disabled for the Tenant.",
		);

		await assert.rejects(connectTo(port), (error: unknown) => {
			assert.ok(error instanceof MailConnectionError);
			assert.equal(error.kind, "auth");
			assert.match(error.message, /SmtpClientAuthentication is disabled/);
			return true;
		});
		assert.equal(state.connections, 1);
	});
});
