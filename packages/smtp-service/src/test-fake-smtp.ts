import net from "node:net";

export interface FakeSmtpOptions {
	authResponse?: string;
	dataFinalResponse?: string;
	dropAfterGreeting?: boolean;
}

export interface FakeSmtp {
	port: number;
	authCommands: string[];
	received: string[];
	close: () => void;
}

export const startFakeSmtp = (opts: FakeSmtpOptions = {}): Promise<FakeSmtp> =>
	new Promise((resolve) => {
		const authCommands: string[] = [];
		const received: string[] = [];
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
					received.push(line);
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
				received,
				close: () => server.close(),
			});
		});
	});
