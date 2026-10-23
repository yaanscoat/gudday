export const $ = selector => document.querySelector(selector);

export const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
	({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const icon = id => `<svg class="icon"><use href="#i-${id}"/></svg>`;

export const calmMotion = () =>
	document.documentElement.hasAttribute("data-lowpower") || matchMedia("(prefers-reduced-motion: reduce)").matches;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export const timeAgo = at => {
	const seconds = Math.round((at - Date.now()) / 1000);
	if (Math.abs(seconds) < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return relative.format(hours, "hour");
	return relative.format(Math.round(hours / 24), "day");
};
