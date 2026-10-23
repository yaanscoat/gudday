import { getTransport } from "./engine.js";

const ZONE_HTML = "https://rawcdn.githack.com/freebuisness/html/main";
const ZONE_COVER = "https://cdn.jsdelivr.net/gh/freebuisness/covers@main";
const CKV_HTML = "https://rawcdn.githack.com/gmshelf/ckv/main/";
const CKV_COVER = "https://cdn.jsdelivr.net/gh/gmshelf/ckv@main/";
const CACHE_NAME = "gudday-data";
const CACHE_KEY = "https://gudday.invalid/games-v1";
const TTL_MS = 6 * 60 * 60 * 1000;

const abs = (value, base) => {
	if (typeof value !== "string" || !value) return "";
	try {
		return new URL(value, base).href;
	} catch {
		return "";
	}
};

// `viaProxy` feeds send no CORS headers, so they're fetched over the Wisp connection instead.
export const sources = [
	{
		id: "selenite",
		label: "Selenite",
		feed: "https://selenite.cc/resources/games.json",
		map: list => list.map(g => {
			const dir = abs(`${g.directory}/`, "https://selenite.cc/resources/semag/");
			return { n: g.name, u: dir, i: abs(g.image, dir) };
		})
	},
	{
		id: "zones",
		label: "Zones",
		feed: "https://cdn.jsdelivr.net/gh/freebuisness/assets@latest/zones.json",
		map: list => list
			.filter(g => typeof g.url === "string" && g.url.startsWith("{HTML_URL}") && !String(g.name).startsWith("[!]"))
			.map(g => ({
				n: g.name,
				u: g.url.replace("{HTML_URL}", ZONE_HTML),
				i: String(g.cover ?? "").replace("{COVER_URL}", ZONE_COVER)
			}))
	},
	{
		id: "velara",
		label: "Velara",
		feed: "https://velara.cc/data/games.json",
		viaProxy: true,
		map: list => list.map(g => ({
			n: g.title,
			u: abs(g.location, "https://velara.cc/"),
			i: abs(g.image, "https://velara.cc/")
		}))
	},
	{
		id: "truffled",
		label: "Truffled",
		feed: "https://truffled.lol/js/json/g.json",
		viaProxy: true,
		map: data => (data?.games ?? []).map(g => ({
			n: g.name,
			u: abs(g.url, "https://truffled.lol/"),
			i: abs(g.thumbnail, "https://truffled.lol/")
		}))
	},
	{
		id: "playables",
		label: "YouTube Playables",
		feed: "https://raw.githubusercontent.com/bubbls/youtube-playables/main/all-playables-formatted.json",
		// Prefer the direct game page; the youtube.com wrapper is much heavier.
		map: list => list.map(g => ({ n: g.title, u: g.raw_game_url || g.game_url || "", i: g.image_url || "" }))
	},
	{
		id: "ckv",
		label: "CKV",
		feed: "https://raw.githubusercontent.com/gmshelf/ckv/main/ckv.json",
		borrowNames: true,
		map: data => (data?.games ?? []).map(g => ({
			n: g.name,
			u: abs(String(g.url ?? "").replace(/^\/+/, ""), CKV_HTML),
			i: abs(String(g.img ?? "").replace(/^\/+/, ""), CKV_COVER)
		}))
	}
];

const perSource = new Map();
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const squash = name => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const fetchFeed = async source => {
	if (!source.viaProxy) {
		const res = await fetch(source.feed);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	}
	const transport = await getTransport();
	const res = await transport.request(new URL(source.feed), "GET", null, [["accept", "application/json"]], AbortSignal.timeout(20000));
	if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
	return JSON.parse(await new Response(res.body).text());
};

const normalize = (source, raw) => source.map(raw).filter(g =>
	typeof g.n === "string" && g.n.trim() && typeof g.u === "string" && g.u.startsWith("https://"));

const build = () => {
	// Some feeds only have squashed ids ("10minutestilldawn"); borrow a proper title from another source.
	const titles = new Map();
	for (const source of sources) {
		if (source.borrowNames) continue;
		for (const g of perSource.get(source.id)?.games ?? []) {
			const key = squash(g.n);
			if (!titles.has(key)) titles.set(key, g.n.trim());
		}
	}
	const games = [];
	const summary = sources.map(source => {
		const entry = perSource.get(source.id) ?? { games: [], ok: true, loading: true };
		for (const g of entry.games) {
			const name = source.borrowNames ? titles.get(squash(g.n)) ?? g.n : g.n;
			games.push({ n: name.trim(), u: g.u, i: g.i, s: source.id });
		}
		return { id: source.id, label: source.label, count: entry.games.length, ok: entry.ok, loading: Boolean(entry.loading) };
	});
	games.sort((a, b) => collator.compare(a.n, b.n));
	return { sources: summary, games };
};

const readCache = async () => {
	try {
		const res = await (await caches.open(CACHE_NAME)).match(CACHE_KEY);
		return res ? await res.json() : null;
	} catch {
		return null;
	}
};

const writeCache = async () => {
	try {
		const body = JSON.stringify({ savedAt: Date.now(), perSource: Object.fromEntries(perSource) });
		await (await caches.open(CACHE_NAME)).put(CACHE_KEY, new Response(body, { headers: { "content-type": "application/json" } }));
	} catch {}
};

// Calls onUpdate with the merged library as soon as anything is known (cache first, then each
// source as it arrives). Resolves once every source has been tried.
export const loadGames = async onUpdate => {
	const cached = await readCache();
	if (cached?.perSource) {
		for (const [id, entry] of Object.entries(cached.perSource)) perSource.set(id, { games: entry.games ?? [], ok: entry.ok !== false });
		onUpdate(build());
		if (Date.now() - cached.savedAt < TTL_MS && sources.every(s => perSource.has(s.id))) return;
	} else {
		onUpdate(build());
	}
	await Promise.all(sources.map(async source => {
		try {
			perSource.set(source.id, { games: normalize(source, await fetchFeed(source)), ok: true });
		} catch (error) {
			console.warn(`[gudday] game source ${source.id} failed:`, error?.message ?? error);
			perSource.set(source.id, { games: perSource.get(source.id)?.games ?? [], ok: false });
		}
		onUpdate(build());
	}));
	await writeCache();
};
