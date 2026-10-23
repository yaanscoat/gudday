import * as storage from "./storage.js";
const text = (max = 200) => (value, fallback) => {
    const s = typeof value === "string" ? value.trim() : "";
    return s.length <= max ? s : fallback;
};
const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
const oneOf = (allowed) => (value, fallback) => allowed.includes(value) ? value : fallback;
const httpUrl = (value, fallback) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s)
        return "";
    try {
        const url = new URL(s);
        return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    }
    catch {
        return fallback;
    }
};
const wsUrl = (value, fallback) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s)
        return "";
    try {
        const url = new URL(s);
        return ["ws:", "wss:"].includes(url.protocol) ? url.href : fallback;
    }
    catch {
        return fallback;
    }
};
const searchTemplate = (value, fallback) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s.includes("%s"))
        return fallback;
    try {
        const probe = new URL(s.replaceAll("%s", "test"));
        return ["http:", "https:"].includes(probe.protocol) ? s : fallback;
    }
    catch {
        return fallback;
    }
};
export const searchEngines = [
    {
        id: "duckduckgo",
        label: "DuckDuckGo",
        template: "https://duckduckgo.com/?q=%s"
    },
    {
        id: "brave",
        label: "Brave",
        template: "https://search.brave.com/search?q=%s"
    },
    {
        id: "startpage",
        label: "Startpage",
        template: "https://www.startpage.com/sp/search?query=%s"
    },
    { id: "bing", label: "Bing", template: "https://www.bing.com/search?q=%s" },
    {
        id: "google",
        label: "Google",
        template: "https://www.google.com/search?q=%s"
    }
];
const cloakIcon = (background, text) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="${background}"/><text x="16" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="white">${text}</text></svg>`)}`;
export const cloakPresets = [
    { id: "custom", label: "Custom", title: "", favicon: "" },
    {
        id: "classroom",
        label: "Google Classroom",
        title: "Classes",
        favicon: cloakIcon("#1e8e3e", "C")
    },
    {
        id: "drive",
        label: "Google Drive",
        title: "My Drive - Google Drive",
        favicon: cloakIcon("#f9ab00", "D")
    },
    {
        id: "desmos",
        label: "Desmos",
        title: "Desmos | Graphing Calculator",
        favicon: cloakIcon("#2d70b3", "D")
    },
    {
        id: "docs",
        label: "Google Docs",
        title: "Google Docs",
        favicon: cloakIcon("#4285f4", "G")
    }
];
export const themes = [
    { id: "crimson", label: "Crimson", swatch: ["#ff3b47", "#ffffff"] },
    { id: "snow", label: "Snow", swatch: ["#ffffff", "#e5243b"] },
    { id: "rose", label: "Rose", swatch: ["#ff4d8d", "#ffd6e6"] },
    { id: "ember", label: "Ember", swatch: ["#ff7a1a", "#ffe2c7"] },
    { id: "ocean", label: "Ocean", swatch: ["#2f9bff", "#d4ecff"] },
    { id: "forest", label: "Forest", swatch: ["#2ecc71", "#d5f7e3"] },
    { id: "violet", label: "Violet", swatch: ["#9b6bff", "#e6dcff"] },
    { id: "mono", label: "Mono", swatch: ["#111111", "#ffffff"] }
];
export const particleEffects = ["none", "snow", "rain", "stars", "fireflies", "sakura", "bubbles", "embers"];
export const gameSources = ["all", "selenite", "zones", "velara", "truffled", "playables", "ckv"];
export const sections = [
    { id: "browsing", label: "Browsing" },
    { id: "cloaking", label: "Cloaking" }
];
export const schema = {
    searchEngine: {
        section: "browsing",
        label: "Search engine",
        default: "https://duckduckgo.com/?q=%s",
        validate: searchTemplate,
        help: "Used when what you typed is not a URL. Must contain %s."
    },
    homeUrl: {
        section: "browsing",
        label: "Home page",
        default: "",
        validate: httpUrl,
        help: "Opened for new tabs."
    },
    cloakPreset: {
        section: "cloaking",
        label: "Preset",
        default: "custom",
        validate: oneOf([
            "custom",
            "classroom",
            "drive",
            "desmos",
            "docs"
        ]),
        help: "Sets the tab title and icon. Choose Custom to fill them in yourself."
    },
    cloakTitle: {
        section: "cloaking",
        label: "Tab title",
        default: "",
        validate: text(120)
    },
    cloakFavicon: {
        section: "cloaking",
        label: "Tab icon URL",
        default: "",
        validate: httpUrl
    },
    saveHistory: {
        section: "browsing",
        label: "Save history",
        default: true,
        validate: bool
    },
    wispUrl: {
        section: "browsing",
        label: "Proxy server",
        default: "",
        validate: wsUrl
    },
    theme: {
        section: "appearance",
        label: "Theme",
        default: "crimson",
        validate: oneOf(themes.map(t => t.id))
    },
    lowPower: {
        section: "appearance",
        label: "Performance mode",
        default: false,
        validate: bool
    },
    gameSource: {
        section: "games",
        label: "Game source",
        default: "all",
        validate: oneOf(gameSources)
    },
    background: {
        section: "appearance",
        label: "Background",
        default: "default",
        validate: oneOf(["default", "custom", "none"])
    },
    particles: {
        section: "appearance",
        label: "Background effect",
        default: "none",
        validate: oneOf(particleEffects)
    }
};
export const defaults = Object.fromEntries(Object.entries(schema).map(([key, def]) => [key, def.default]));
const storeKey = "settings";
let current = null;
const listeners = new Set();
const validate = (raw) => {
    const out = {};
    const rejected = [];
    for (const [name, entry] of Object.entries(schema)) {
        const def = entry;
        const incoming = raw?.[name];
        if (incoming === undefined) {
            out[name] = def.default;
            continue;
        }
        const invalid = Symbol(name);
        const value = def.validate(incoming, invalid);
        if (value === invalid) {
            rejected.push(name);
            out[name] = def.default;
        }
        else {
            out[name] = value;
        }
    }
    return { settings: out, rejected };
};
export const load = () => {
    if (current)
        return current;
    current = validate(storage.read(storeKey, {})).settings;
    return current;
};
export const get = (name) => load()[name];
export const all = () => ({ ...load() });
export const set = (patch) => {
    const { settings, rejected } = validate({ ...load(), ...patch });
    current = settings;
    const persisted = storage.write(storeKey, settings);
    for (const fn of listeners)
        fn(settings, rejected);
    return { settings, rejected, persisted };
};
export const reset = () => {
    current = { ...defaults };
    const persisted = storage.write(storeKey, current);
    for (const fn of listeners)
        fn(current, []);
    return { settings: current, persisted };
};
export const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};
