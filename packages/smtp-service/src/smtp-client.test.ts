import assert from "node:assert/strict";
import net from "node:net";
import { after, describe, it } from "node:test";
import type { MailMessage } from "./message-builder.js";
import {
	directSmtpSocket,
	type SmtpConfig,
	SmtpConnectionError,
	type SmtpCredentials,
	sendMail,
	verifySmtpConnection,
} from "./smtp-client.js";
import {
	type FakeSmtp,
	type FakeSmtpOptions,
	startFakeSmtp,
} from "./test-fake-smtp.js";

interface SocketRequest {
	host: string | undefined;
	port: string | number | undefined;
}

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
	getSocket: directSmtpSocket,
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

	it("talks to the server over the socket the host's factory opens", async () => {
		const server = await spawn();
		const requests: SocketRequest[] = [];
		const result = await sendMail(
			{
				...configFor(server.port),
				host: "smtp.invalid",
				port: 2525,
				getSocket: (request, callback) => {
					requests.push({ host: request.host, port: request.port });
					const connection = net.connect(server.port, "127.0.0.1", () =>
						callback(null, { connection }),
					);
				},
			},
			testMessage,
		);

		assert.equal(result.success, true);
		assert.deepEqual(requests, [{ host: "smtp.invalid", port: 2525 }]);
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

	it("throws a classified auth error on a 535 AUTH rejection, in the server's words", async () => {
		// What Microsoft answers a tenant with SMTP AUTH switched off. Signing in
		// again never clears it, so the text has to survive classification for the
		// account card to say what actually has to change.
		const server = await spawn({
			authResponse:
				"535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant\r\n",
		});

		await assert.rejects(
			sendMail(configFor(server.port), testMessage),
			(error: unknown) => {
				assert.ok(error instanceof SmtpConnectionError);
				assert.equal(error.kind, "auth");
				assert.match(error.message, /SmtpClientAuthentication is disabled/);
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

describe("verifySmtpConnection", () => {
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

	it("succeeds when the server accepts the login", async () => {
		const server = await spawn();

		const result = await verifySmtpConnection(configFor(server.port));

		assert.deepEqual(result, { success: true });
	});

	it("reports a rejected login as an authentication failure", async () => {
		const server = await spawn({
			authResponse: "535 5.7.8 Authentication credentials invalid\r\n",
		});

		const result = await verifySmtpConnection(configFor(server.port));

		assert.deepEqual(result, {
			success: false,
			error:
				"SMTP authentication failed: 535 5.7.8 Authentication credentials invalid",
		});
	});
});
