import { engine, reconnect, wispUrl, defaultWispUrl } from "./engine.js";
import { loadGames } from "./games.js";
import * as storage from "./storage.js";
import { resolveInput, formatForDisplay } from "./url.js";
import * as settings from "./settings.js";
import * as visitLog from "./history.js";
import { applyCloak } from "./cloak.js";
import { notify } from "./notify.js";
import { listEffects, setEffect, setPaused } from "./particles.js";
import { applyWallpaper, setWallpaperFile, setWallpaperUrl } from "./wallpaper.js";
import { $, esc, icon } from "./ui.js";

const root = document.documentElement;

let activeEffect = null;
const applyAppearance = () => {
	root.dataset.theme = settings.get("theme");
	root.toggleAttribute("data-lowpower", settings.get("lowPower"));
	const effect = settings.get("lowPower") ? "none" : settings.get("particles");
	if (effect !== activeEffect) {
		activeEffect = effect;
		setEffect(effect).catch(error => notify(error.message, { type: "error", title: "Background effect" }));
	}
};

/* Views */
const views = { home: $("#view-home"), games: $("#view-games"), browser: $("#view-browser") };

const showView = name => {
	for (const [key, el] of Object.entries(views)) el.toggleAttribute("data-active", key === name);
	for (const item of document.querySelectorAll(".dock-item")) {
		if (item.dataset.view === name) item.setAttribute("aria-current", "page");
		else item.removeAttribute("aria-current");
	}
	// The browser fills the screen, so there's nothing to animate behind it.
	setPaused(name === "browser");
	if (name === "games") showGames();
	if (name === "home") $("#home-input").focus();
};

document.addEventListener("click", event => {
	const target = event.target.closest("[data-view]");
	if (target) showView(target.dataset.view);
});

/* Browser */
const frameWrap = $("#frame-wrap");
const address = $("#address");
const navButtons = ["#nav-back", "#nav-forward", "#nav-reload"].map($);
let session = null;
let sessionPending = null;

const setLoading = on => ($("#loading").hidden = !on);

const onUrl = url => {
	if (document.activeElement !== address) address.value = formatForDisplay(url);
	if (settings.get("saveHistory")) visitLog.record(url);
};

const getSession = async () => {
	if (session) return session;
	sessionPending ??= (async () => {
		const frame = document.createElement("iframe");
		frame.allow = "autoplay; fullscreen; gamepad; clipboard-read; clipboard-write";
		frameWrap.append(frame);
		try {
			return await engine.createSession(frame, {
				url: onUrl,
				loading: () => setLoading(true),
				ready: () => setLoading(false),
				error: () => setLoading(false),
				escape: url => void open(url)
			});
		} catch (error) {
			frame.remove();
			sessionPending = null;
			throw error;
		}
	})();
	session = await sessionPending;
	for (const button of navButtons) button.disabled = false;
	return session;
};

const open = async input => {
	const { url, kind } = resolveInput(input, settings.get("searchEngine"));
	if (kind === "empty") return;
	if (kind === "blocked" || kind === "internal") {
		notify("That address can't be opened through the proxy.", { type: "warning" });
		return;
	}
	if (kind === "external") {
		location.assign(url);
		return;
	}
	showView("browser");
	$("#browser-empty").hidden = true;
	address.value = formatForDisplay(url);
	setLoading(true);
	try {
		(await getSession()).go(url);
	} catch (error) {
		setLoading(false);
		notify(error?.message ?? "The proxy failed to start.", { type: "error", title: "Couldn't open that page" });
	}
};

for (const button of navButtons) button.disabled = true;
$("#nav-back").addEventListener("click", () => session?.back());
$("#nav-forward").addEventListener("click", () => session?.forward());
$("#nav-reload").addEventListener("click", () => session?.reload());
$("#nav-fullscreen").addEventListener("click", () => frameWrap.requestFullscreen?.());

$("#address-form").addEventListener("submit", event => {
	event.preventDefault();
	address.blur();
	void open(address.value);
});

$("#home-search").addEventListener("submit", event => {
	event.preventDefault();
	const input = $("#home-input");
	void open(input.value);
	input.value = "";
});

/* Games */
const grid = $("#games-grid");
const sentinel = $("#games-sentinel");
const filterInput = $("#games-filter");
const emptyNote = $("#games-empty");
const PAGE = 96;
let library = null;
let libraryDone = false;
let markLibraryReady;
const libraryReady = new Promise(resolve => (markLibraryReady = resolve));
let filtered = [];
let shown = 0;

const sourceLabel = id => library?.sources.find(s => s.id === id)?.label ?? id;

const cardHtml = (game, index) => `
	<button type="button" class="card" data-index="${index}" title="${esc(game.n)}">
		<div class="thumb">${icon("gamepad")}${game.i ? `<img src="${esc(game.i)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</div>
		<div class="card-meta"><span class="card-name">${esc(game.n)}</span><span class="card-source">${esc(sourceLabel(game.s))}</span></div>
	</button>`;

const renderMore = () => {
	if (shown >= filtered.length) return;
	const next = filtered.slice(shown, shown + PAGE);
	grid.insertAdjacentHTML("beforeend", next.map((g, i) => cardHtml(g, shown + i)).join(""));
	shown += next.length;
};

const observer = new IntersectionObserver(entries => {
	if (!entries.some(e => e.isIntersecting)) return;
	renderMore();
	if (shown < filtered.length) {
		observer.unobserve(sentinel);
		observer.observe(sentinel);
	}
}, { root: views.games, rootMargin: "900px 0px" });

const renderSourceChips = () => {
	const current = settings.get("gameSource");
	const items = [{ id: "all", label: "All", count: library.games.length, ok: true }, ...library.sources];
	$("#source-chips").innerHTML = items.map(s => `
		<button type="button" role="radio" class="source-chip" data-source="${s.id}" aria-checked="${s.id === current}"${s.ok ? "" : ` data-down title="Source unreachable right now"`}>
			${esc(s.label)}<span class="count">${s.loading ? "..." : s.count.toLocaleString()}</span>
		</button>`).join("");
};

const applyFilter = () => {
	const source = settings.get("gameSource");
	const query = filterInput.value.trim().toLowerCase();
	filtered = library.games.filter(g =>
		(source === "all" || g.s === source) && (!query || g.n.toLowerCase().includes(query)));
	shown = 0;
	grid.replaceChildren();
	views.games.scrollTop = 0;
	renderMore();
	$("#games-count").textContent = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "game" : "games"}`;
	emptyNote.hidden = filtered.length > 0;
	emptyNote.textContent = query ? `No games match "${filterInput.value.trim()}".` : "This source has no games right now.";
	observer.unobserve(sentinel);
	observer.observe(sentinel);
};

const showSkeletons = () => {
	grid.innerHTML = Array.from({ length: 18 }, () =>
		`<div class="card skeleton"><div class="thumb"></div><div class="card-meta"></div></div>`).join("");
};

const showGames = () => {
	if (library) renderSourceChips();
	if (library?.games.length) {
		if (!filtered.length || grid.querySelector(".skeleton")) applyFilter();
		return;
	}
	emptyNote.hidden = !libraryDone;
	if (libraryDone) {
		grid.replaceChildren();
		emptyNote.textContent = "Couldn't reach any game source. Check your connection and reload.";
	} else {
		showSkeletons();
	}
};

// Sources arrive one at a time; re-render as they do, unless the visitor has scrolled into the list.
const onLibrary = data => {
	library = data;
	if (data.games.length) markLibraryReady(data);
	$("#home-game-count").textContent = data.games.length ? data.games.length.toLocaleString() : "";
	if (views.games.hasAttribute("data-active")) {
		renderSourceChips();
		if (views.games.scrollTop < 40 && data.games.length) applyFilter();
	}
	if (dialog.open) renderSources();
};

const setSource = id => {
	settings.set({ gameSource: id });
	if (library) {
		renderSourceChips();
		applyFilter();
	}
};

$("#source-chips").addEventListener("click", event => {
	const chip = event.target.closest("[data-source]");
	if (chip) setSource(chip.dataset.source);
});

let filterTimer;
filterInput.addEventListener("input", () => {
	clearTimeout(filterTimer);
	filterTimer = setTimeout(() => library && applyFilter(), 120);
});

grid.addEventListener("click", event => {
	const card = event.target.closest(".card[data-index]");
	const game = card && filtered[Number(card.dataset.index)];
	if (game) void open(game.u);
});
grid.addEventListener("load", event => {
	if (event.target.tagName === "IMG") event.target.classList.add("loaded");
}, true);
grid.addEventListener("error", event => {
	if (event.target.tagName === "IMG") event.target.remove();
}, true);

const openRandom = async pool => {
	await libraryReady;
	const list = pool?.() ?? library.games;
	if (!list.length) return;
	void open(list[Math.floor(Math.random() * list.length)].u);
};

$("#home-random").addEventListener("click", () => void openRandom());
$("#games-random").addEventListener("click", () => void openRandom(() => filtered));

/* Settings */
const dialog = $("#settings");

const optionHtml = (value, label, sub, checked) => `
	<button type="button" role="radio" class="option" data-value="${esc(value)}" aria-checked="${checked}">
		<span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>${icon("check")}
	</button>`;

const update = patch => {
	const { rejected } = settings.set(patch);
	applyAppearance();
	applyCloak();
	renderSettings();
	if (rejected.length) notify("That value wasn't valid, so it was reset.", { type: "warning" });
	else notify("Saved", { type: "success", duration: 1600 });
};

const renderSources = () => {
	const el = $("#source-options");
	if (!library) {
		el.innerHTML = `<p class="muted">Loading game library...</p>`;
		return;
	}
	const current = settings.get("gameSource");
	const items = [{ id: "all", label: "All sources", count: library.games.length, ok: true }, ...library.sources];
	el.innerHTML = items.map(s => optionHtml(s.id, s.label,
		s.loading ? "Loading..." : s.ok ? `${s.count.toLocaleString()} games` : "Unreachable right now", s.id === current)).join("");
};

const renderSettings = () => {
	const current = settings.all();

	$("#engine-options").innerHTML = settings.searchEngines.map(e =>
		optionHtml(e.template, e.label, new URL(e.template.replace("%s", "")).hostname.replace(/^www\./, ""),
			e.template === current.searchEngine)).join("");
	$("#opt-history").checked = current.saveHistory;
	const wisp = $("#opt-wisp");
	wisp.placeholder = defaultWispUrl;
	if (document.activeElement !== wisp) wisp.value = current.wispUrl;

	$("#theme-options").innerHTML = settings.themes.map(t => `
		<button type="button" role="radio" class="theme" data-value="${t.id}" aria-checked="${t.id === current.theme}">
			<div class="theme-preview" style="background:${t.swatch[0]};--dot:${t.swatch[1]}"></div>
			<span>${esc(t.label)}</span>
		</button>`).join("");
	$("#opt-lowpower").checked = current.lowPower;
	$("#background-options").innerHTML = [
		["default", "Default", "The gudday wallpaper"],
		["custom", "Custom", "Upload or link your own"],
		["none", "None", "Plain theme colour"]
	].map(([value, label, sub]) => optionHtml(value, label, sub, value === current.background)).join("");
	renderEffects(current.particles);

	renderSources();

	$("#cloak-options").innerHTML = settings.cloakPresets.map(p =>
		optionHtml(p.id, p.label, p.title || "Your own title", p.id === current.cloakPreset)).join("");
	const custom = current.cloakPreset === "custom";
	const title = $("#opt-cloak-title");
	const favicon = $("#opt-cloak-icon");
	title.disabled = favicon.disabled = !custom;
	if (document.activeElement !== title) title.value = current.cloakTitle;
	if (document.activeElement !== favicon) favicon.value = current.cloakFavicon;
};

let effects = null;
const renderEffects = selected => {
	const el = $("#effect-options");
	if (!effects) {
		el.innerHTML = `<p class="muted">Loading effects...</p>`;
		listEffects().then(list => {
			effects = list;
			renderEffects(settings.get("particles"));
		}, () => (el.innerHTML = `<p class="muted">Couldn't load effects.</p>`));
		return;
	}
	el.innerHTML = [{ id: "none", label: "None", description: "No particles" }, ...effects]
		.map(e => optionHtml(e.id, e.label, e.description, e.id === selected)).join("");
};

const renderHistory = () => {
	const entries = visitLog.all().slice(0, 100);
	const list = $("#history-list");
	if (!entries.length) {
		list.innerHTML = `<li class="muted">Nothing here yet.</li>`;
		return;
	}
	const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
	list.innerHTML = entries.map(e => `
		<li><button type="button" data-url="${esc(e.url)}">
			<span class="url">${esc(formatForDisplay(e.url))}</span><span class="time">${esc(time.format(e.at))}</span>
		</button></li>`).join("");
};

let versionInfo = null;

const workerVersion = () => new Promise(resolve => {
	const worker = navigator.serviceWorker?.controller;
	if (!worker) return resolve(null);
	const channel = new MessageChannel();
	const timer = setTimeout(() => resolve("outdated"), 1000);
	channel.port1.onmessage = event => {
		clearTimeout(timer);
		resolve(event.data);
	};
	worker.postMessage({ type: "gudday:sw-version" }, [channel.port2]);
});

const buildText = build => {
	if (build?.state === "ok") return `Build ${build.number} · ${build.short}`;
	if (build?.state === "empty") return "No builds yet";
	return "GitHub unreachable";
};

const REPO = "yaanscoat/gudday";
const BUILD_TTL_MS = 10 * 60 * 1000;

// Latest commit on GitHub; with per_page=1 the "last" page number is the total commit count.
const latestBuild = async () => {
	const cached = storage.read("build", null);
	if (cached && Date.now() - cached.at < BUILD_TTL_MS) return cached.build;
	let build;
	try {
		const res = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=1`, {
			headers: { accept: "application/vnd.github+json" }
		});
		if (res.status === 409) {
			build = { state: "empty" };
		} else {
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const [commit] = await res.json();
			const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(res.headers.get("link") ?? "");
			build = {
				state: "ok",
				number: last ? Number(last[1]) : 1,
				short: commit.sha.slice(0, 7),
				date: commit.commit.committer?.date ?? commit.commit.author?.date ?? null,
				message: commit.commit.message.split("\n")[0],
				url: commit.html_url
			};
		}
	} catch {
		return cached?.build ?? { state: "unavailable" };
	}
	storage.write("build", { at: Date.now(), build });
	return build;
};

const renderAbout = async () => {
	try {
		const [changelog, build] = await Promise.all([
			fetch("changelog.json").then(res => res.json()),
			latestBuild()
		]);
		versionInfo = { version: changelog[0].version, name: changelog[0].name, repo: `https://github.com/${REPO}`, build, changelog };
	} catch {}
	const info = versionInfo;
	const build = info?.build;
	const sw = await workerVersion();
	const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

	$("#ver-name").textContent = info ? info.name : "gudday";
	$("#ver-number").textContent = info ? `Version ${info.version}` : "Version info unavailable";
	$("#ver-built").textContent = build?.state === "ok" && build.date ? `Built ${aest.format(new Date(build.date))}` : "";
	const pill = $("#ver-build");
	pill.querySelector("span").textContent = buildText(build);
	if (build?.state === "ok") pill.href = build.url;
	else if (info) pill.href = info.repo;
	else pill.removeAttribute("href");
	pill.title = build?.state === "ok" ? build.message : "";

	const facts = [
		["Version name", info?.name ?? "Unknown"],
		["Version", info?.version ?? "Unknown"],
		["Build", build?.state === "ok"
			? `#${build.number} (${build.short})`
			: buildText(build)],
		...(build?.state === "ok" ? [["Build time", build.date ? aest.format(new Date(build.date)) : "Unknown"], ["Latest commit", build.message]] : []),
		["Engine", "Scramjet"],
		["Transport", "Wisp (Epoxy)"],
		["Proxy server", wispUrl()],
		["Service worker", sw === "outdated" ? "Outdated, close every gudday tab and reopen" : sw ? `v${sw}` : "Starts on first visit"],
		["Games", library
			? `${library.games.length.toLocaleString()} total (${library.sources.map(s => `${s.label} ${s.count}`).join(", ")})`
			: "Not loaded yet"]
	];
	$("#about-list").innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

	$("#changelog").innerHTML = (info?.changelog ?? []).map((entry, index) => `
		<li>
			<header>
				<span class="tag">v${esc(entry.version)}</span>
				<strong>${esc(entry.name)}</strong>
				<span class="muted">${esc(day.format(new Date(entry.date)))}</span>
				${index === 0 ? `<span class="current">Current</span>` : ""}
			</header>
			<ul>${entry.changes.map(change => `<li>${esc(change)}</li>`).join("")}</ul>
		</li>`).join("") || `<li class="muted">Changelog unavailable.</li>`;
	void renderClients();
};

// Build times are shown in eastern Australian time (AEST, or AEDT during daylight saving).
const aest = new Intl.DateTimeFormat("en-AU", {
	timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric",
	hour: "numeric", minute: "2-digit", timeZoneName: "short"
});

const askWorker = type => new Promise(resolve => {
	const worker = navigator.serviceWorker?.controller;
	if (!worker) return resolve(null);
	const channel = new MessageChannel();
	const timer = setTimeout(() => resolve(null), 1500);
	channel.port1.onmessage = event => {
		clearTimeout(timer);
		resolve(event.data);
	};
	worker.postMessage({ type }, [channel.port2]);
});

const proxiedTarget = url => {
	const match = /\/~\/sj\/[^/]+\/[^/]+\/([^?#]*)/.exec(url);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
};

const renderClients = async () => {
	const list = $("#client-list");
	const clients = await askWorker("gudday:clients");
	if (!clients) {
		list.innerHTML = `<li class="muted">The service worker isn't running yet. Open a page in the browser first.</li>`;
		return;
	}
	const rows = clients.filter(c => !c.url.endsWith("/sw.js")).map(c => {
		const target = proxiedTarget(c.url);
		const kind = c.type !== "window" ? "Worker" : target ? "Proxied page" : c.frameType === "top-level" ? "gudday tab" : "Frame";
		const label = target ? formatForDisplay(target) : c.self ? "This tab" : formatForDisplay(c.url);
		const state = c.self ? "You are here" : c.focused ? "Focused" : c.visibility === "visible" ? "Visible" : c.visibility === "hidden" ? "In background" : "";
		return { kind, label, state, rank: c.self ? 0 : target ? 2 : 1 };
	}).sort((a, b) => a.rank - b.rank);
	list.innerHTML = rows.map(r => `
		<li>
			<span class="client-icon">${icon(r.kind === "Proxied page" ? "globe" : r.kind === "Worker" ? "layers" : "monitor")}</span>
			<div><strong>${esc(r.label)}</strong><span class="muted">${esc(r.kind)}${r.state ? ` · ${esc(r.state)}` : ""}</span></div>
		</li>`).join("") || `<li class="muted">No active clients.</li>`;
};

const selectTab = name => {
	for (const tab of dialog.querySelectorAll("[role=tab]")) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
	for (const pane of dialog.querySelectorAll("[data-pane]")) pane.hidden = pane.dataset.pane !== name;
	if (name === "history") renderHistory();
	if (name === "about") renderAbout();
};

const toggleSettings = () => {
	if (dialog.open) {
		dialog.close();
		return;
	}
	renderSettings();
	dialog.showModal();
};

$("#open-settings").addEventListener("click", toggleSettings);
dialog.addEventListener("click", event => {
	if (event.target === dialog || event.target.closest("[data-close]")) dialog.close();
	const tab = event.target.closest("[role=tab]");
	if (tab) selectTab(tab.dataset.tab);
});

$("#engine-options").addEventListener("click", event => {
	const option = event.target.closest("[data-value]");
	if (option) update({ searchEngine: option.dataset.value });
});
$("#theme-options").addEventListener("click", event => {
	const option = event.target.closest("[data-value]");
	if (option) update({ theme: option.dataset.value });
});
$("#source-options").addEventListener("click", event => {
	const option = event.target.closest("[data-value]");
	if (!option) return;
	setSource(option.dataset.value);
	renderSources();
	notify("Saved", { type: "success", duration: 1600 });
});
$("#background-options").addEventListener("click", async event => {
	const option = event.target.closest("[data-value]");
	if (!option) return;
	if (option.dataset.value === "custom") {
		$("#bg-file").click();
		return;
	}
	update({ background: option.dataset.value });
	await applyWallpaper();
});
$("#effect-options").addEventListener("click", event => {
	const option = event.target.closest("[data-value]");
	if (!option) return;
	update({ particles: option.dataset.value });
	if (settings.get("lowPower") && option.dataset.value !== "none") {
		notify("Effects are paused while performance mode is on.", { type: "warning" });
	}
});
const useWallpaper = async task => {
	const note = notify("Setting your background...", { duration: 0 });
	try {
		await task();
		renderSettings();
		notify("Background updated", { type: "success" });
	} catch (error) {
		notify(error?.message ?? "That image couldn't be used.", { type: "error", title: "Background" });
	} finally {
		note.querySelector(".note-close")?.click();
	}
};
$("#bg-upload").addEventListener("click", () => $("#bg-file").click());
$("#bg-file").addEventListener("change", event => {
	const [file] = event.target.files;
	event.target.value = "";
	if (file) void useWallpaper(() => setWallpaperFile(file));
});
$("#bg-url-form").addEventListener("submit", event => {
	event.preventDefault();
	const url = $("#bg-url").value.trim();
	if (url) void useWallpaper(() => setWallpaperUrl(url));
});
$("#refresh-clients").addEventListener("click", () => void renderClients());
$("#cloak-options").addEventListener("click", event => {
	const option = event.target.closest("[data-value]");
	if (option) update({ cloakPreset: option.dataset.value });
});
$("#opt-history").addEventListener("change", event => update({ saveHistory: event.target.checked }));
$("#opt-wisp").addEventListener("change", async event => {
	update({ wispUrl: event.target.value });
	try {
		await reconnect();
		notify(wispUrl(), { type: "success", title: "Proxy server changed" });
	} catch {
		notify("Couldn't connect to that proxy server.", { type: "error" });
	}
});
$("#opt-lowpower").addEventListener("change", event => update({ lowPower: event.target.checked }));
$("#opt-cloak-title").addEventListener("change", event => update({ cloakTitle: event.target.value }));
$("#opt-cloak-icon").addEventListener("change", event => update({ cloakFavicon: event.target.value }));

$("#history-list").addEventListener("click", event => {
	const item = event.target.closest("[data-url]");
	if (!item) return;
	dialog.close();
	void open(item.dataset.url);
});
$("#clear-history").addEventListener("click", () => {
	visitLog.clear();
	renderHistory();
	notify("History cleared", { type: "success" });
});

$("#reset-settings").addEventListener("click", () => {
	settings.reset();
	applyAppearance();
	applyCloak();
	renderSettings();
	if (library) {
		renderSourceChips();
		applyFilter();
	}
	void applyWallpaper();
	notify("Settings reset", { type: "success" });
});

$("#open-blank").addEventListener("click", () => {
	const tab = window.open("about:blank", "_blank");
	if (!tab) {
		notify("Allow popups for this site, then try again.", { type: "warning", title: "Popup blocked" });
		return;
	}
	const doc = tab.document;
	doc.title = document.title;
	const iconHref = document.querySelector("link[rel~='icon']")?.href;
	if (iconHref) {
		const link = doc.createElement("link");
		link.rel = "icon";
		link.href = iconHref;
		doc.head.append(link);
	}
	const style = doc.createElement("style");
	style.textContent = "html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}";
	doc.head.append(style);
	const frame = doc.createElement("iframe");
	frame.src = location.href;
	frame.allow = "autoplay; fullscreen; gamepad; clipboard-read; clipboard-write";
	doc.body.append(frame);
});

/* Keyboard */
addEventListener("keydown", event => {
	if ((event.ctrlKey || event.metaKey) && event.key === ",") {
		event.preventDefault();
		toggleSettings();
		return;
	}
	const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
	if (event.key === "/" && !typing && !dialog.open) {
		event.preventDefault();
		const active = Object.entries(views).find(([, el]) => el.hasAttribute("data-active"))?.[0];
		({ home: $("#home-input"), games: filterInput, browser: address })[active]?.focus();
	}
});

addEventListener("offline", () => notify("Pages and games won't load until you're back online.", { type: "warning", title: "You're offline", duration: 0 }));
addEventListener("online", () => notify("You're back online.", { type: "success" }));

/* Start */
void applyWallpaper();
applyAppearance();
applyCloak();
showView("home");
loadGames(onLibrary)
	.catch(error => console.warn("[gudday] game library failed:", error))
	.finally(() => {
		libraryDone = true;
		if (views.games.hasAttribute("data-active")) showGames();
		const down = library?.sources.filter(source => !source.ok).map(source => source.label) ?? [];
		if (down.length && !sessionStorage.getItem("gudday:sources-warned")) {
			sessionStorage.setItem("gudday:sources-warned", "1");
			notify(`${down.join(", ")} couldn't be reached. Their games are hidden for now.`, { type: "warning", title: "Some game sources are offline" });
		}
	});
// Warm up the proxy once the page is idle so the first search opens quickly.
(window.requestIdleCallback ?? (fn => setTimeout(fn, 1500)))(() => engine.init().catch(() => {}), { timeout: 4000 });
