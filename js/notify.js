import { $, esc, icon, calmMotion, timeAgo } from "./ui.js";

const ICONS = { info: "info", success: "circle-check", warning: "alert", error: "circle-x" };
const MAX_VISIBLE = 4;
const HISTORY_LIMIT = 40;

const stack = $("#note-stack");
const panel = $("#notes-panel");
const bell = $("#open-notes");
const history = [];
let unread = 0;

const spring = "cubic-bezier(0.2, 0.9, 0.3, 1.25)";

// The stack lives in the top layer; re-show it so new notes land above an open modal dialog.
const raise = () => {
	if (stack.matches(":popover-open")) {
		if (!document.querySelector("dialog:modal")) return;
		stack.hidePopover();
	}
	stack.showPopover();
};

const renderBadge = () => {
	const badge = bell.querySelector(".badge");
	badge.textContent = unread > 9 ? "9+" : String(unread);
	badge.hidden = unread === 0;
};

const renderPanel = () => {
	const list = panel.querySelector(".notes-list");
	list.innerHTML = history.length
		? history.map(n => `
			<li class="note-row" data-type="${n.type}">
				<span class="note-icon">${icon(ICONS[n.type])}</span>
				<div><strong>${esc(n.title || n.message)}</strong>${n.title ? `<p>${esc(n.message)}</p>` : ""}</div>
				<time>${esc(timeAgo(n.at))}</time>
			</li>`).join("")
		: `<li class="notes-empty">You're all caught up.</li>`;
};

const dismiss = note => {
	if (note.dataset.leaving) return;
	note.dataset.leaving = "1";
	note.progress?.cancel();
	if (calmMotion()) {
		note.remove();
		return;
	}
	const height = note.offsetHeight;
	note.animate(
		[
			{ opacity: 1, transform: "translateX(0) scale(1)", height: `${height}px`, marginBottom: "10px" },
			{ opacity: 0, transform: "translateX(28px) scale(0.96)", height: `${height}px`, marginBottom: "10px", offset: 0.55 },
			{ opacity: 0, transform: "translateX(28px) scale(0.96)", height: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" }
		],
		{ duration: 380, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
	).onfinish = () => note.remove();
};

const startTimer = (note, duration) => {
	note.progress?.cancel();
	if (!duration) return;
	const bar = note.querySelector(".note-progress");
	note.progress = bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration, easing: "linear", fill: "forwards" });
	note.progress.onfinish = () => dismiss(note);
};

const enableSwipe = note => {
	let startX = null;
	note.addEventListener("pointerdown", event => {
		if (event.target.closest("button")) return;
		startX = event.clientX;
		note.setPointerCapture(event.pointerId);
		note.progress?.pause();
	});
	note.addEventListener("pointermove", event => {
		if (startX === null) return;
		const dx = Math.max(0, event.clientX - startX);
		note.style.transform = `translateX(${dx}px)`;
		note.style.opacity = String(1 - Math.min(dx / 220, 0.8));
	});
	const end = event => {
		if (startX === null) return;
		const dx = event.clientX - startX;
		startX = null;
		if (dx > 90) {
			dismiss(note);
			return;
		}
		note.style.transform = note.style.opacity = "";
		note.progress?.play();
	};
	note.addEventListener("pointerup", end);
	note.addEventListener("pointercancel", end);
};

/**
 * Show a notification. Identical visible notes merge (with a count) instead of stacking.
 * options: { type: "info" | "success" | "warning" | "error", title, duration (ms, 0 = sticky), action: { label, run } }
 */
export const notify = (message, { type = "info", title = "", duration, action } = {}) => {
	duration ??= type === "error" ? 6000 : type === "success" ? 2600 : 4000;
	history.unshift({ type, title, message, at: Date.now() });
	history.length = Math.min(history.length, HISTORY_LIMIT);
	if (!panel.matches(":popover-open")) unread += 1;
	renderBadge();
	if (panel.matches(":popover-open")) renderPanel();

	raise();
	const key = `${type}|${title}|${message}`;
	const existing = [...stack.children].find(n => n.dataset.key === key && !n.dataset.leaving);
	if (existing) {
		const count = Number(existing.dataset.count ?? 1) + 1;
		existing.dataset.count = String(count);
		existing.querySelector(".note-count").textContent = `×${count}`;
		if (!calmMotion()) existing.animate([{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: 260, easing: spring });
		startTimer(existing, duration);
		return existing;
	}

	const note = document.createElement("div");
	note.className = "note";
	note.dataset.type = type;
	note.dataset.key = key;
	note.setAttribute("role", type === "error" ? "alert" : "status");
	note.innerHTML = `
		<span class="note-icon">${icon(ICONS[type] ?? "info")}</span>
		<div class="note-body">${title ? `<strong>${esc(title)}</strong>` : ""}<p>${esc(message)}</p></div>
		<span class="note-count"></span>
		${action ? `<button type="button" class="note-action">${esc(action.label)}</button>` : ""}
		<button type="button" class="note-close" aria-label="Dismiss">${icon("x")}</button>
		<span class="note-progress"></span>`;
	note.querySelector(".note-close").addEventListener("click", () => dismiss(note));
	note.querySelector(".note-action")?.addEventListener("click", () => {
		action.run();
		dismiss(note);
	});
	note.addEventListener("mouseenter", () => note.progress?.pause());
	note.addEventListener("mouseleave", () => note.progress?.play());
	enableSwipe(note);
	stack.prepend(note);

	const visible = [...stack.children].filter(n => !n.dataset.leaving);
	for (const old of visible.slice(MAX_VISIBLE)) dismiss(old);

	if (!calmMotion()) {
		note.animate(
			[
				{ opacity: 0, transform: "translateY(-14px) scale(0.94)", filter: "blur(4px)" },
				{ opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" }
			],
			{ duration: 420, easing: spring }
		);
	}
	startTimer(note, duration);
	return note;
};

bell.addEventListener("click", () => {
	renderPanel();
	panel.togglePopover();
});
panel.addEventListener("toggle", event => {
	if (event.newState === "open") {
		unread = 0;
		renderBadge();
	}
});
panel.querySelector("[data-clear]").addEventListener("click", () => {
	history.length = 0;
	renderPanel();
});
renderBadge();
