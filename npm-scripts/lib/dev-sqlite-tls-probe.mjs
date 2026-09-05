#!/usr/bin/env node
// Claim 3 of `npm run dev:sqlite:health`: the TLS front answers.
//
// A connect alone would not be enough — the check has to complete a handshake
// and read a response, because "something holds the port" and "the front-end is
// serving the stack" are different facts and the day this was written the port
// was answering neither.
//
// The certificate is a local one no store trusts, and whose name is on it is not
// the question here, so verification is off and only the handshake matters.
import { request } from "node:https";

const port = Number(process.env.REMIT_DEV_TLS_PORT ?? 4143);
const host = process.env.REMIT_DEV_TLS_HOST ?? "127.0.0.1";
const timeoutMs = Number(process.env.REMIT_DEV_TLS_TIMEOUT_MS ?? 5000);

const probe = request(
	{
		host,
		port,
		path: "/",
		method: "GET",
		rejectUnauthorized: false,
		servername: "localhost",
		timeout: timeoutMs,
	},
	(response) => {
		response.resume();
		const status = response.statusCode ?? 0;
		// A 5xx is the front-end reporting that what it proxies to is down, which
		// is the shape "vite returns 500 behind a listening TLS front" takes.
		if (status >= 500) {
			console.error(`tls: port ${port} answered over TLS with ${status}`);
			process.exit(1);
		}
		console.log(`port ${port} answered over TLS with ${status}`);
		process.exit(0);
	},
);

probe.on("timeout", () => {
	probe.destroy(new Error(`no answer within ${timeoutMs}ms`));
});

probe.on("error", (error) => {
	console.error(`tls: port ${port} did not answer over TLS — ${error.message}`);
	process.exit(1);
});

probe.end();
