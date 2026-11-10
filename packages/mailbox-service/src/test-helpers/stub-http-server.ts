import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

export interface StubRequest {
	method: string;
	path: string;
	headers: IncomingHttpHeaders;
	body: string;
}

export type StubReply = { status: number; body: string } | "Silent";

export interface StubHttpServer {
	baseUrl: string;
	requests: StubRequest[];
	close(): Promise<void>;
}

const listen = (server: Server): Promise<number> =>
	new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve(typeof address === "object" && address ? address.port : 0);
		});
	});

const shutDown = (server: Server): Promise<void> =>
	new Promise((resolve) => {
		server.closeAllConnections();
		server.close(() => resolve());
	});

export const startStubHttpServer = async (
	reply: (request: StubRequest) => StubReply,
): Promise<StubHttpServer> => {
	const requests: StubRequest[] = [];
	const server = createServer((incoming, outgoing) => {
		const chunks: Buffer[] = [];
		incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
		incoming.on("end", () => {
			const request: StubRequest = {
				method: incoming.method ?? "",
				path: incoming.url ?? "",
				headers: incoming.headers,
				body: Buffer.concat(chunks).toString("utf8"),
			};
			requests.push(request);
			const answer = reply(request);
			if (answer === "Silent") return;
			outgoing.writeHead(answer.status, {
				"content-type": "application/json",
			});
			outgoing.end(answer.body);
		});
	});
	const port = await listen(server);
	return {
		baseUrl: `http://127.0.0.1:${port}`,
		requests,
		close: () => shutDown(server),
	};
};

export const closedPortBaseUrl = async (): Promise<string> => {
	const server = createServer();
	const port = await listen(server);
	await shutDown(server);
	return `http://127.0.0.1:${port}`;
};
