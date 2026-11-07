import {
	createAuth,
	createPeopleDirectory,
	openIdentityStore,
	resolveAuthConfig,
} from "@remit/auth-service";
import { installNodeLogger } from "@remit/logger-lambda/node";

installNodeLogger();

const USAGE = `Usage: node people-admin.mjs <enable|reset> <email>

  enable <email>  Let a disabled account sign in again.
  reset <email>   Print a single-use password reset link for the account.
`;

const run = async (): Promise<void> => {
	const [command, email, ...rest] = process.argv.slice(2);
	if (
		(command !== "enable" && command !== "reset") ||
		!email ||
		rest.length > 0
	) {
		process.stderr.write(USAGE);
		process.exitCode = 2;
		return;
	}

	const config = resolveAuthConfig();
	const store = await openIdentityStore(config.connectionString);
	const people = await createPeopleDirectory({
		auth: await createAuth(config, store),
		store,
		baseURL: config.baseURL,
	});
	const unknownEmail = (): void => {
		process.stderr.write(`No account has the email ${email}.\n`);
		process.exitCode = 1;
	};
	try {
		if (command === "enable") {
			const enabled = await people.enableByEmail(email);
			if (!enabled.ok) return unknownEmail();
			process.stdout.write(`${email} is enabled.\n`);
			return;
		}
		const reset = await people.resetByEmail(email);
		if (!reset.ok) return unknownEmail();
		process.stdout.write(
			`Password reset link for ${email}, valid 24 hours and once:\n${reset.value.resetUrl}\n`,
		);
		if (!config.signInEnabled) {
			process.stdout.write(
				"Sign-in is off, so the link works once 'remit sign-in on' runs.\n",
			);
		}
	} finally {
		people.close();
	}
};

await run().catch((error: unknown) => {
	process.stderr.write(
		`people: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
