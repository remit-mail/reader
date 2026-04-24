import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const config = getConfig(
	{
		target: "react",
		autoCodeSplitting: true,
	},
	root,
);

const generator = new Generator({ config, root });
await generator.run();
