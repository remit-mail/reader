const globalTeardown = async () => {
	const worker = globalThis.__e2eWorkerProcess;
	if (!worker) return;

	console.log("E2E Global Teardown: stopping imap-worker...");
	worker.kill("SIGTERM");

	await new Promise<void>((resolve) => {
		const timeout = setTimeout(() => {
			worker.kill("SIGKILL");
			resolve();
		}, 5000);

		worker.on("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
	});

	console.log("E2E Global Teardown: done");
};

export default globalTeardown;
