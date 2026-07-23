import assert from "node:assert/strict";
import net from "node:net";
import { after, describe, it } from "node:test";
import type { MailMessage } from "./message-builder.js";
import {
	type SmtpConfig,
	SmtpConnectionError,
	type SmtpCredentials,
	sendMail,
} from "./smtp-client.js";

interface FakeSmtpOptions {
	authResponse?: string;
	dataFinalResponse?: string;
	dropAfterGreeting?: boolean;
}

interface FakeSmtp {
	port: number;
	authCommands: string[];
	close: () => void;
}

const startFakeSmtp = (opts: FakeSmtpOptions = {}): Promise<FakeSmtp> =>
	new Promise((resolve) => {
		const authCommands: string[] = [];
		const server = net.createServer((socket) => {
			if (opts.dropAfterGreeting) {
				socket.destroy();
				return;
			}
			socket.write("220 fake ESMTP\r\n");
			let inData = false;
			socket.on("data", (buffer) => {
				const line = buffer.toString();
				if (inData) {
					if (line.includes("\r\n.\r\n")) {
						inData = false;
						socket.write(opts.dataFinalResponse ?? "250 2.0.0 Ok\r\n");
					}
					return;
				}
				const command = line.slice(0, 4).toUpperCase();
				if (command.startsWith("EHLO") || command.startsWith("HELO")) {
					socket.write("250-fake\r\n250 AUTH PLAIN LOGIN XOAUTH2\r\n");
					return;
				}
				if (command.startsWith("AUTH")) {
					authCommands.push(line.trim());
					socket.write(opts.authResponse ?? "235 2.7.0 Accepted\r\n");
					return;
				}
				if (command.startsWith("MAIL") || command.startsWith("RCPT")) {
					socket.write("250 2.1.0 Ok\r\n");
					return;
				}
				if (command.startsWith("DATA")) {
					socket.write("354 End data\r\n");
					inData = true;
					return;
				}
				if (command.startsWith("QUIT")) {
					socket.write("221 Bye\r\n");
					socket.end();
					return;
				}
				socket.write("250 Ok\r\n");
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			resolve({
				port,
				authCommands,
				close: () => server.close(),
			});
		});
	});

const configFor = (
	port: number,
	credentials: SmtpCredentials = { kind: "password", password: "secret" },
): SmtpConfig => ({
	host: "127.0.0.1",
	port,
	secure: false,
	user: "user@example.com",
	credentials,
	connectionTimeout: 2000,
});

const testMessage: MailMessage = {
	from: "user@example.com",
	to: ["recipient@example.com"],
	subject: "Subject",
	text: "Body",
	messageId: "<message@example.com>",
};

describe("sendMail", () => {
	const servers: FakeSmtp[] = [];
	const spawn = async (opts?: FakeSmtpOptions): Promise<FakeSmtp> => {
		const server = await startFakeSmtp(opts);
		servers.push(server);
		return server;
	};

	after(() => {
		for (const server of servers) {
			server.close();
		}
	});

	it("returns success with the SMTP response on delivery", async () => {
		const server = await spawn();
		const result = await sendMail(configFor(server.port), testMessage);

		assert.equal(result.success, true);
		assert.equal(result.isTransient, false);
		assert.ok(result.response);
	});

	it("sends attachments through the transport", async () => {
		const server = await spawn();
		const result = await sendMail(configFor(server.port), {
			...testMessage,
			html: "<p>hi</p>",
			cc: ["cc@example.com"],
			bcc: ["bcc@example.com"],
			replyTo: "reply@example.com",
			inReplyTo: "<parent@example.com>",
			references: "<a@example.com> <b@example.com>",
			attachments: [
				{
					filename: "note.txt",
					content: Buffer.from("hello"),
					contentType: "text/plain",
					contentDisposition: "attachment",
				},
			],
		});

		assert.equal(result.success, true);
	});

	it("uses XOAUTH2 for access-token credentials", async () => {
		const server = await spawn();
		const result = await sendMail(
			configFor(server.port, { kind: "accessToken", accessToken: "token-abc" }),
			testMessage,
		);

		assert.equal(result.success, true);
		assert.ok(
			server.authCommands.some((command) => command.startsWith("AUTH XOAUTH2")),
			"expected an AUTH XOAUTH2 command",
		);
	});

	it("throws a classified auth error on a 535 AUTH rejection", async () => {
		const server = await spawn({
			authResponse: "535 5.7.8 Authentication credentials invalid\r\n",
		});

		await assert.rejects(
			sendMail(configFor(server.port), testMessage),
			(error: unknown) => {
				assert.ok(error instanceof SmtpConnectionError);
				assert.equal(error.kind, "auth");
				assert.equal(error.message, "SMTP authentication failed");
				return true;
			},
		);
	});

	it("treats a 5xx delivery rejection as a permanent failure", async () => {
		const server = await spawn({
			dataFinalResponse: "550 5.0.0 Rejected\r\n",
		});
		const result = await sendMail(configFor(server.port), testMessage);

		assert.equal(result.success, false);
		assert.equal(result.smtpCode, 550);
		assert.equal(result.isTransient, false);
		assert.ok(result.error);
	});

	it("treats a 4xx delivery rejection as a transient failure", async () => {
		const server = await spawn({
			dataFinalResponse: "451 4.3.0 Try again later\r\n",
		});
		const result = await sendMail(configFor(server.port), testMessage);

		assert.equal(result.success, false);
		assert.equal(result.smtpCode, 451);
		assert.equal(result.isTransient, true);
	});

	it("returns a non-transient failure when the socket errors without an SMTP code", async () => {
		const server = await spawn({ dropAfterGreeting: true });
		const result = await sendMail(configFor(server.port), testMessage);

		assert.equal(result.success, false);
		assert.equal(result.isTransient, false);
		assert.equal(result.smtpCode, undefined);
		assert.ok(result.error);
	});
});
