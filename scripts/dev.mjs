// Tiny static server for local testing. `--base /gudday/` mimics a GitHub Pages project site.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const base = process.argv.includes("--base") ? `/${arg("--base").replace(/^\/|\/$/g, "")}/`.replace("//", "/") : "/";
const port = Number(process.env.PORT ?? (process.argv.includes("--port") ? arg("--port") : 8080));

const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm",
    ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp"
};

http.createServer(async (req, res) => {
    const pathname = (req.url ?? "/").split(/[?#]/)[0];
    if (!pathname.startsWith(base)) {
        res.writeHead(302, { location: base }).end();
        return;
    }
    let file;
    try {
        file = path.join(root, decodeURIComponent(pathname.slice(base.length)));
    } catch {
        res.writeHead(400).end("Bad request");
        return;
    }
    if (!file.startsWith(root) || /[\\/](node_modules|scripts)([\\/]|$)/.test(file.slice(root.length))) {
        res.writeHead(404).end("Not found");
        return;
    }
    try {
        if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
        await stat(file);
    } catch {
        res.writeHead(404).end("Not found");
        return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    createReadStream(file).pipe(res);
}).listen(port, () => console.log(`gudday dev server: http://localhost:${port}${base}`));
