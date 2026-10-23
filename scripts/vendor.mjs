// Copies the proxy runtime out of node_modules into vendor/, which is committed so the
// site can be served as-is by GitHub Pages or any other static host.
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const distOf = pkg => path.join(root, "node_modules", pkg);

const files = {
    "scramjet/scramjet.js": ["@mercuryworkshop/scramjet", "dist/scramjet.js"],
    "scramjet/scramjet.wasm": ["@mercuryworkshop/scramjet", "dist/scramjet.wasm"],
    "controller/controller.api.js": ["@mercuryworkshop/scramjet-controller", "dist/controller.api.js"],
    "controller/controller.inject.js": ["@mercuryworkshop/scramjet-controller", "dist/controller.inject.js"],
    "controller/controller.sw.js": ["@mercuryworkshop/scramjet-controller", "dist/controller.sw.js"],
    "utils/scramjet-utils.js": ["@mercuryworkshop/scramjet-utils", "dist/scramjet-utils.js"],
    "epoxy/index.mjs": ["@mercuryworkshop/epoxy-transport", "dist/index.mjs"]
};

const out = path.join(root, "vendor");
await rm(out, { recursive: true, force: true });
for (const [target, [pkg, file]] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(out, target)), { recursive: true });
    await cp(path.join(distOf(pkg), file), path.join(out, target));
}
console.log(`Vendored ${Object.keys(files).length} files into vendor/`);
