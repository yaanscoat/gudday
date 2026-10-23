// Background particle effects. Each effect is a JSON file in public/assets/json/, listed in particles.json.
const jsonRoot = new URL("../public/assets/json/", import.meta.url);
const canvas = document.getElementById("fx");
const ctx = canvas.getContext("2d");

let config = null;
let particles = [];
let frame = 0;
let last = 0;
let paused = false;
let width = 0;
let height = 0;
let dpr = 1;
let indexPromise = null;
const sprites = new Map();

const rand = ([min, max] = [0, 0]) => min + Math.random() * (max - min);
const pick = list => list[Math.floor(Math.random() * list.length)];
const toRad = deg => (deg * Math.PI) / 180;

export const listEffects = () => {
	indexPromise ??= fetch(new URL("particles.json", jsonRoot)).then(res => res.json()).then(data => data.effects);
	return indexPromise;
};

const glowSprite = color => {
	if (sprites.has(color)) return sprites.get(color);
	const sprite = document.createElement("canvas");
	sprite.width = sprite.height = 64;
	const g = sprite.getContext("2d");
	const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0, color);
	gradient.addColorStop(0.25, color);
	gradient.addColorStop(1, "transparent");
	g.fillStyle = gradient;
	g.fillRect(0, 0, 64, 64);
	sprites.set(color, sprite);
	return sprite;
};

const spawn = (anywhere = true) => {
	const angle = toRad(config.direction + rand([-config.spread, config.spread]));
	const speed = rand(config.speed);
	const p = {
		x: Math.random() * width,
		y: Math.random() * height,
		vx: Math.cos(angle) * speed,
		vy: Math.sin(angle) * speed,
		size: rand(config.size),
		len: rand(config.length ?? [0, 0]),
		color: pick(config.colors),
		alpha: rand(config.opacity),
		phase: Math.random() * Math.PI * 2,
		twinkle: rand(config.twinkle ?? [0, 0]),
		sway: rand(config.sway ?? [0, 0]),
		spin: rand(config.spin ?? [0, 0]) * (Math.random() < 0.5 ? -1 : 1),
		rotation: Math.random() * Math.PI * 2
	};
	if (!anywhere) {
		// Re-enter from the edge the particle is travelling away from.
		if (Math.abs(p.vy) >= Math.abs(p.vx)) p.y = p.vy > 0 ? -20 : height + 20;
		else p.x = p.vx > 0 ? -20 : width + 20;
	}
	return p;
};

const resize = () => {
	dpr = Math.min(devicePixelRatio || 1, 1.5);
	width = innerWidth;
	height = innerHeight;
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (!config) return;
	const target = Math.min(config.max, Math.round(width * height * config.density));
	while (particles.length < target) particles.push(spawn());
	particles.length = target;
};

const draw = (p, t) => {
	let alpha = p.alpha;
	if (p.twinkle) alpha *= 0.55 + 0.45 * Math.sin(t * p.twinkle + p.phase);
	if (config.fade) alpha *= Math.min(1, p.y / height + 0.15);
	ctx.globalAlpha = Math.max(0, alpha);
	switch (config.shape) {
		case "line": {
			const speed = Math.hypot(p.vx, p.vy) || 1;
			ctx.strokeStyle = p.color;
			ctx.lineWidth = p.size;
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
			ctx.lineTo(p.x - (p.vx / speed) * p.len, p.y - (p.vy / speed) * p.len);
			ctx.stroke();
			break;
		}
		case "glow": {
			const s = p.size * 7;
			ctx.drawImage(glowSprite(p.color), p.x - s / 2, p.y - s / 2, s, s);
			break;
		}
		case "petal":
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(p.rotation);
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
			break;
		case "ring":
			ctx.strokeStyle = p.color;
			ctx.lineWidth = 1.2;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
			ctx.stroke();
			break;
		default:
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
			ctx.fill();
	}
};

const tick = now => {
	frame = requestAnimationFrame(tick);
	const step = Math.min((now - last) / 16.67, 3);
	last = now;
	const t = now / 1000;
	ctx.clearRect(0, 0, width, height);
	for (let i = 0; i < particles.length; i++) {
		const p = particles[i];
		if (config.wander) {
			const turn = (Math.random() - 0.5) * config.wander * step;
			const cos = Math.cos(turn);
			const sin = Math.sin(turn);
			[p.vx, p.vy] = [p.vx * cos - p.vy * sin, p.vx * sin + p.vy * cos];
		}
		p.x += (p.vx + Math.sin(t * 1.3 + p.phase) * p.sway * 0.3) * step;
		p.y += p.vy * step;
		p.rotation += p.spin * 0.02 * step;
		const out = p.x < -40 || p.x > width + 40 || p.y < -40 || p.y > height + 40;
		if (out) particles[i] = spawn(false);
		draw(particles[i], t);
	}
	ctx.globalAlpha = 1;
};

const sync = () => {
	cancelAnimationFrame(frame);
	frame = 0;
	const running = config && !paused && !document.hidden;
	canvas.hidden = !config;
	if (running) {
		last = performance.now();
		frame = requestAnimationFrame(tick);
	} else if (!config) {
		ctx.clearRect(0, 0, width, height);
	}
};

export const setEffect = async id => {
	if (!id || id === "none") {
		config = null;
		particles = [];
		sync();
		return;
	}
	const res = await fetch(new URL(`${id}.json`, jsonRoot));
	if (!res.ok) throw new Error(`Effect "${id}" not found`);
	const loaded = await res.json();
	config = { spread: 0, direction: 90, max: 150, density: 0.00008, colors: ["#fff"], ...loaded };
	particles = [];
	resize();
	sync();
};

export const setPaused = value => {
	paused = value;
	sync();
};

addEventListener("resize", resize);
document.addEventListener("visibilitychange", sync);
resize();
