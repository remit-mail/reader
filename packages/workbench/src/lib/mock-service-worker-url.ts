/**
 * Where the MSW registration finds `mockServiceWorker.js` depends on who is
 * loading `iframe.html`, and the two callers disagree.
 *
 * The Storybook Vitest addon (`@storybook/addon-vitest`) runs stories inside
 * its own browser test harness, whose page sits several path segments below
 * the harness server's root even though `staticDirs` are still served from
 * that root — only a root-absolute URL reaches the worker script there.
 *
 * Everywhere else — local `storybook dev`/`build-storybook`, and the
 * published GitHub Pages site under the `/reader/` subpath — `iframe.html`
 * and `mockServiceWorker.js` are served from the same directory, so a
 * document-relative URL reaches it regardless of how deep that directory
 * itself is mounted. A root-absolute URL breaks this case: on GitHub Pages
 * it resolves to the site root, one level above where the worker script
 * actually lives.
 */
export function resolveMockServiceWorkerUrl(isVitest: boolean): string {
	return isVitest ? "/mockServiceWorker.js" : "./mockServiceWorker.js";
}
