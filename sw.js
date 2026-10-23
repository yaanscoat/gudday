importScripts("vendor/controller/controller.sw.js");

const SW_VERSION = "1.3.0";
const shellCache = `gudday-shell-${SW_VERSION}`;
const scopePath = new URL(self.registration.scope).pathname;
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

// App files (including the vendored runtime) are served from cache and refreshed in the
// background, so repeat visits open instantly. Skipped on localhost to keep development live.
const isShellRequest = request => {
	if (request.method !== "GET" || isLocal) return false;
	const url = new URL(request.url);
	return url.origin === location.origin &&
		url.pathname.startsWith(scopePath) &&
		!url.search &&
		!url.pathname.endsWith("/sw.js");
};

const shellResponse = async event => {
	const cache = await caches.open(shellCache);
	const cached = await cache.match(event.request);
	const network = fetch(event.request).then(response => {
		if (response.ok) cache.put(event.request, response.clone());
		return response;
	});
	if (cached) {
		event.waitUntil(network.catch(() => {}));
		return cached;
	}
	return network;
};

// The controller forwards `request.body`, which Firefox doesn't implement (so POSTs went out
// empty and broke sites like YouTube). Buffer the body and hand the controller an ArrayBuffer.
const withBufferedBody = async event => {
	const { request } = event;
	if (request.method === "GET" || request.method === "HEAD") return event;
	const buffer = await request.arrayBuffer();
	const body = buffer.byteLength ? buffer : null;
	const shimmed = new Proxy(request, {
		get(target, prop) {
			if (prop === "body") return body;
			const value = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		}
	});
	return {
		request: shimmed,
		clientId: event.clientId,
		resultingClientId: event.resultingClientId
	};
};

self.addEventListener("fetch", event => {
	if ($scramjetController.shouldRoute(event)) {
		event.respondWith(
			withBufferedBody(event).then(routed => $scramjetController.route(routed))
		);
		return;
	}
	if (isShellRequest(event.request)) event.respondWith(shellResponse(event));
});

self.addEventListener("message", event => {
	const port = event.ports[0];
	if (event.data?.type === "gudday:sw-version") port?.postMessage(SW_VERSION);
	if (event.data?.type === "gudday:clients") {
		event.waitUntil(
			self.clients.matchAll({ includeUncontrolled: true, type: "all" }).then(list => port?.postMessage(list.map(client => ({
				type: client.type,
				frameType: client.frameType,
				url: client.url,
				visibility: client.visibilityState ?? null,
				focused: client.focused ?? false,
				self: client.id === event.source?.id
			}))))
		);
	}
});

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event =>
	event.waitUntil(
		caches
			.keys()
			.then(keys => Promise.all(
				keys
					.filter(key => (key.startsWith("gudday-shell-") && key !== shellCache) || key.startsWith("my-serverless-proxy-shell-"))
					.map(key => caches.delete(key))
			))
			.then(() => self.clients.claim())
	)
);
