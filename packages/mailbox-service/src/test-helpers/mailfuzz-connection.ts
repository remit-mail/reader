import { ImapFlowConnection } from "../imapflow-connection.js";

export const MAILFUZZ_CONFIG = {
	host: process.env.MAILFUZZ_HOST ?? "localhost",
	port: Number(process.env.MAILFUZZ_PORT ?? 1143),
	user: process.env.MAILFUZZ_USER ?? "vmail",
	password: process.env.MAILFUZZ_PASSWORD ?? "testpass123",
	tls: false,
};

export const createMailfuzzConnection = (): ImapFlowConnection =>
	new ImapFlowConnection(MAILFUZZ_CONFIG);

export const withMailfuzzConnection = async (
	fn: (connection: ImapFlowConnection) => Promise<void>,
): Promise<void> => {
	const connection = createMailfuzzConnection();
	await connection.connect();
	await fn(connection).finally(() => {
		if (connection.isConnected) {
			return connection.disconnect();
		}
	});
};
