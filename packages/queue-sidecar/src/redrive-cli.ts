import { runRedriveCli } from "./redrive.js";

process.exit(
	await runRedriveCli(process.argv.slice(2), {
		env: process.env,
		out: (text) => process.stdout.write(text),
		err: (text) => process.stderr.write(text),
	}),
);
