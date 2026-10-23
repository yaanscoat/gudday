import * as settings from "./settings.js";
import { getTransport } from "./engine.js";

const CACHE_NAME = "gudday-data";
const CACHE_KEY = "https://gudday.invalid/wallpaper";
const DEFAULT_SRC = new URL("../background.jpeg", import.meta.url).href;
const MAX_EDGE = 2560;
const root = document.documentElement;
let objectUrl = null;

// Bake a tiny blurred copy of the wallpaper; glass panels show it instead of blurring live.
const frost = src => {
	if (!src) {
		root.style.setProperty("--frost", "none");
		return;
	}
	const img = new Image();
	img.onload = () => {
		const width = 160;
		const height = Math.max(1, Math.round((width * img.naturalHeight) / img.naturalWidth));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		ctx.filter = "blur(2.5px)";
		ctx.drawImage(img, -3, -3, width + 6, height + 6);
		canvas.toBlob(blob => {
			if (blob) root.style.setProperty("--frost", `url("${URL.createObjectURL(blob)}")`);
		}, "image/webp", 0.85);
	};
	img.src = src;
};

const show = src => {
	root.style.setProperty("--wallpaper", src ? `url("${src}")` : "none");
	frost(src);
};

const readStored = async () => {
	try {
		const res = await (await caches.open(CACHE_NAME)).match(CACHE_KEY);
		return res ? await res.blob() : null;
	} catch {
		return null;
	}
};

// Downscale huge images once, so the background never costs more than a 2560px webp.
const shrink = async blob => {
	const bitmap = await createImageBitmap(blob);
	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	if (scale === 1 && blob.size < 1_500_000) return blob;
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	return new Promise(resolve => canvas.toBlob(out => resolve(out ?? blob), "image/webp", 0.9));
};

export const applyWallpaper = async () => {
	const mode = settings.get("background");
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	objectUrl = null;
	if (mode === "none") return show(null);
	if (mode === "custom") {
		const blob = await readStored();
		if (blob) {
			objectUrl = URL.createObjectURL(blob);
			return show(objectUrl);
		}
	}
	show(DEFAULT_SRC);
};

const store = async blob => {
	if (!blob.type.startsWith("image/")) throw new Error("That file isn't an image.");
	const small = await shrink(blob);
	await (await caches.open(CACHE_NAME)).put(CACHE_KEY, new Response(small, { headers: { "content-type": small.type } }));
	settings.set({ background: "custom" });
	await applyWallpaper();
};

export const setWallpaperFile = file => store(file);

export const setWallpaperUrl = async url => {
	const target = new URL(url);
	if (!["http:", "https:"].includes(target.protocol)) throw new Error("Use an http(s) image link.");
	let blob;
	try {
		const res = await fetch(target);
		if (!res.ok) throw new Error();
		blob = await res.blob();
	} catch {
		// No CORS on that host: fetch it over the Wisp connection instead.
		const transport = await getTransport();
		const res = await transport.request(target, "GET", null, [["accept", "image/*"]], AbortSignal.timeout(20000));
		if (res.status !== 200) throw new Error(`The image link returned ${res.status}.`);
		const type = res.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
		blob = new Blob([await new Response(res.body).arrayBuffer()], { type: type.split(";")[0] });
	}
	await store(blob);
};
