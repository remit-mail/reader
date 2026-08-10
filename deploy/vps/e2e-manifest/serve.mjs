/**
 * The e2e stack's stand-in for a manifest host (issue #599). No Alpine base
 * ships an `httpd` applet, so this is Node rather than a shell one-liner.
 * Serves exactly one directory, flat, read-only from its own perspective —
 * `data/` is what the suite writes `manifest.json` into and removes it from,
 * so a 404 for a missing file is what gives the stack its known starting
 * state (a failed check) without any fixture committed to the repo.
 */
import { readFile } from "node:fs";
import { createServer } from "node:http";
import { basename, join } from "node:path";

const root = process.env.MANIFEST_ROOT ?? "/www";

createServer((req, res) => {
	const file = join(root, basename(req.url ?? ""));
	readFile(file, (err, data) => {
		if (err) {
			res.writeHead(404);
			res.end();
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(data);
	});
}).listen(80);
