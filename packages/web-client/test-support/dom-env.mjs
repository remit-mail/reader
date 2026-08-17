// The shared environment, reached through this package's own test-support
// directory: `src/` ships to registry consumers, so nothing under it may name a
// private workspace package.
export * from "@remit/test-dom";
