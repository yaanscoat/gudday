import * as settings from "./settings.js";

// Resolve everything against the site root so the app also works under a subpath,
// like a GitHub Pages project site (https://user.github.io/gudday/).
const siteRoot = new URL("../", import.meta.url);
const at = path => new URL(path, siteRoot).href;
export const defaultWispUrl = "wss://wisp.mercurywork.shop/";
export const wispUrl = () => settings.get("wispUrl") || defaultWispUrl;
let controller = null;
let ready = null;
let transportPromise = null;
const runtimeScripts = [
    "vendor/scramjet/scramjet.js",
    "vendor/controller/controller.api.js",
    "vendor/utils/scramjet-utils.js"
].map(at);
const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.async = false;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error("Failed to load " + src));
        document.head.append(el);
    });
};
const registerServiceWorker = async () => {
    if (!("serviceWorker" in navigator)) {
        throw new Error("Service workers are unavailable. The page must be served over https:// " +
            "or from localhost.");
    }
    const registration = await navigator.serviceWorker.register(at("sw.js"), {
        scope: siteRoot.pathname,
        updateViaCache: "none"
    });
    // Booting against an outdated worker leaves the proxy on old code (or, once the new
    // worker claims the page, with no routes at all). Wait for any update to take over first.
    try {
        await registration.update();
    }
    catch { }
    const incoming = registration.installing ?? registration.waiting;
    if (incoming) {
        await new Promise(resolve => {
            const settle = () => {
                if (incoming.state === "activated" || incoming.state === "redundant")
                    resolve();
            };
            incoming.addEventListener("statechange", settle);
            settle();
        });
    }
    const ready = await navigator.serviceWorker.ready;
    const worker = registration.active ?? ready.active ?? navigator.serviceWorker.controller;
    if (!worker)
        throw new Error("Service worker registered but never became active");
    return worker;
};
// One Wisp connection, shared by the proxy and by game feeds that lack CORS headers.
export const getTransport = () => {
    transportPromise ??= (async () => {
        const { default: EpoxyTransport } = await import(at("vendor/epoxy/index.mjs"));
        const transport = new EpoxyTransport({ wisp: wispUrl() });
        await transport.init();
        return transport;
    })().catch(error => {
        transportPromise = null;
        throw error;
    });
    return transportPromise;
};
export const reconnect = async () => {
    transportPromise = null;
    const transport = await getTransport();
    controller?.setTransport(transport);
};
const keepAliveIntervalMs = 15000; // super duper jank hopefully scramjet fixes
const startKeepAlive = () => {
    setInterval(() => {
        navigator.serviceWorker.controller?.postMessage("keepalive");
    }, keepAliveIntervalMs);
};
const boot = async () => {
    const [serviceworker, transport] = await Promise.all([
        registerServiceWorker(),
        getTransport(),
        Promise.all(runtimeScripts.map(loadScript))
    ]);
    const api = window.$scramjetController;
    controller = new api.Controller({
        serviceworker,
        transport,
        config: {
            prefix: siteRoot.pathname + "~/sj/",
            scramjetPath: at("vendor/scramjet/scramjet.js"),
            wasmPath: at("vendor/scramjet/scramjet.wasm"),
            injectPath: at("vendor/controller/controller.inject.js")
        }
    });
    await controller.wait();
    startKeepAlive();
    // A worker swapped in mid-session has none of this controller's routes; reload to re-register.
    let activeWorker = navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        const previous = activeWorker;
        activeWorker = navigator.serviceWorker.controller;
        if (previous)
            location.reload();
    });
    return controller;
};
const utils = () => {
    return window
        .$scramjetUtils;
};
let localPlugins = null;
const plugins = () => {
    localPlugins ??= {
        HeaderGuard: class HeaderGuardPlugin extends utils().ManagedPlugin {
            constructor() {
                super("header-guard", []);
            }
            install(frame) {
                super.install(frame);
                // Scramjet iterates rawHeaders unconditionally; a response without them threw
                // "can't access property Symbol.iterator" and failed the whole request.
                this.tap(frame.fetchHandler.hooks.fetch.preresponse, (context, props) => {
                    const response = props.response;
                    if (response && !Array.isArray(response.rawHeaders)) {
                        console.warn("[gudday] response arrived without headers:", context.parsed?.url?.href);
                        response.rawHeaders = [...(response.headers ?? [])];
                    }
                });
            }
        },
        ErrorPage: class ErrorPagePlugin extends utils().ManagedPlugin {
            #onError;
            constructor(onError) {
                super("error-page", []);
                this.#onError = onError;
            }
            install(frame) {
                this.tap(frame.hooks.error.request, (context, props) => {
                    const ctx = context;
                    const out = props;
                    if (ctx.error?.name === "AbortError")
                        return;
                    if (!["document", "iframe", "frame"].includes(ctx.rawrequest?.destination ?? ""))
                        return;
                    out.suppressError = true;
                    out.setResponse = {
                        body: errorPage(ctx.error),
                        headers: [
                            ["content-type", "text/html; charset=utf-8"]
                        ],
                        status: 502,
                        statusText: "Bad Gateway"
                    };
                    this.#onError?.(ctx.error);
                });
            }
        },
        HistoryUrl: class HistoryUrlPlugin extends utils().ManagedPlugin {
            constructor() {
                super("history-url", []);
            }
            install(frame) {
                this.tap(frame.hooks.init.post, (context) => {
                    if (!context.isTopLevel)
                        return;
                    const historyConstructor = context.window.History;
                    const history = historyConstructor.prototype;
                    for (const method of [
                        "pushState",
                        "replaceState"
                    ]) {
                        const original = history[method];
                        history[method] = function (data, unused, url) {
                            return original.call(this, data, unused, url ?? context.client.url.href);
                        };
                    }
                });
            }
        }
    };
    return localPlugins;
};
class ScramjetSession {
    url = "";
    #frame;
    #handlers;
    #destroyed = false;
    #onLoad;
    constructor(frame, handlers) {
        this.#frame = frame;
        this.#handlers = handlers;
        this.#onLoad = () => {
            if (!this.#destroyed)
                this.#handlers.ready?.();
        };
        this.#frame.element.addEventListener("load", this.#onLoad);
    }
    get element() {
        return this.#frame.element;
    }
    go(url) {
        if (this.#destroyed)
            return;
        this.#handlers.loading?.();
        this.#frame.go(url);
    }
    back() {
        if (!this.#destroyed)
            this.#frame.back();
    }
    forward() {
        if (!this.#destroyed)
            this.#frame.forward();
    }
    reload() {
        if (!this.#destroyed)
            this.#frame.reload();
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.#frame.element.removeEventListener("load", this.#onLoad);
        const index = controller?.frames.indexOf(this.#frame) ?? -1;
        if (index !== -1)
            controller.frames.splice(index, 1);
        this.#frame.element.remove();
    }
}
export const engine = {
    id: "scramjet",
    label: "Scramjet",
    supportsTransportSwitch: false,
    async init() {
        ready ??= boot();
        return ready;
    },
    async createSession(element, handlers = {}) {
        await this.init();
        const u = utils();
        const { HeaderGuard, ErrorPage, HistoryUrl } = plugins();
        const session = new ScramjetSession(controller.createFrame(element, {
            plugins: [
                new HeaderGuard(),
                new u.HttpCachePlugin(),
                new HistoryUrl(),
                new u.UrlWatcherPlugin((url) => {
                    session.url = url;
                    handlers.url?.(url);
                    handlers.ready?.();
                }),
                new u.CatchEscapedLinksPlugin((url) => {
                    handlers.escape?.(url.href);
                    return new URL(`data:text/html,${encodeURIComponent(errorPage(new Error("Opened in a new tab.")))}`);
                }),
                new ErrorPage(handlers.error)
            ]
        }), handlers);
        return session;
    },
};
const errorPage = (error) => {
    const message = String(error?.message ?? error ?? "Unknown error").replace(/[<&]/g, c => (c === "<" ? "&lt;" : "&amp;"));
    return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page unavailable</title>
<style>
	html { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
	body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
	main { width: min(32rem, calc(100% - 3rem)); }
	h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
	p { margin: 0 0 .75rem; color: GrayText; }
	code { font-size: .875rem; }
</style>
<main>
	<h1>This page could not be loaded</h1>
	<p>The proxy reached the network but the request failed.</p>
	<p><code>${message}</code></p>
</main>`;
};
export default engine;
