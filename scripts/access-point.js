// GM-Edit: NET Access Points.
// GM: any token can become an Access Point linked to a NET architecture scene (scenes in the folder "NET").
// Players/GM: with a Netrunner token selected, right-click the Access Point → network icon "Jack In".
// A window shows the architecture exactly as the scene looks (background, tiles, drawings, Black ICE /
// Demon tokens). The Netrunner always enters on the leftmost floor tile (unless the GM picked another
// entry floor) and moves floor to floor by clicking a floor or with the arrow keys. "Jack Out" removes it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { primaryGM, ACTIONS_FLAG, PENALTY_FLAG, netActionsLimit, netActionsOf, netActionsPenaltyOf, spendNetActions } from "./support.js";
import { runnerAttackItems, glueOf, setForceOut, postUnsafeCard, linkUnsafeSummary, iceMetOnCards } from "./runner-combat.js";
import { actionsForKinds, configureFloor, FLOOR_KINDS, floorInfo, ICE_ACTIONS, RUNNER_ACTIONS, runNetAction, startIceAction, hasPassed, passageOpen, togglePassage, clearPassages, restoreRez, postJackOutSummary, goingQuiet, stealthOf, isStealthed, postStealthCard, stealthResult } from "./net-actions.js";
const MODULE = "cpr-net-architecture";
const CHANNEL = "module.cpr-net-architecture";
const AP_FLAG = "accessPoint";
const RUN_FLAG = "netrun";
const NET_FOLDER = /^net$/i;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const flagOf = (doc, key) => foundry.utils.getProperty(doc, `flags.${MODULE}.${key}`);
function netActionsHTML(doc) {
    const n = netActionsOf(doc), max = netActionsLimit(doc), penalty = Number(netActionsPenaltyOf(doc).active ?? 0) || 0;
    return `<b>${n}</b>${max ? `<small>/${max}</small>` : ""}${penalty ? `<small class="cprnet-netactions-penalty" title="Vrizzbolt: −${penalty} this turn"> (Vrizzbolt)</small>` : ""}`;
}
export const accessPointData = (doc) => {
    const data = flagOf(doc, AP_FLAG);
    return data?.scene ? data : undefined;
};
export const isAccessPoint = (token) => !!accessPointData(token?.document ?? token);
const gridOf = (scene) => Number(scene?.grid?.size) || 100;
const isVideo = (src) => /\.(webm|mp4|m4v|ogv|mov)(\?.*)?$/i.test(String(src));
/** image or (animated) video – scene backgrounds are often .webm files */
const media = (src, cls, style) => isVideo(src)
    ? `<video class="${cls}" src="${esc(src)}" style="${style}" autoplay loop muted playsinline></video>`
    : `<img class="${cls}" src="${esc(src)}" style="${style}" alt="">`;
/** V12: scene.background.src; older data: scene.img */
const backgroundOf = (scene) => String(scene?.background?.src ?? scene?.img ?? "");
const foregroundOf = (scene) => String(scene?.foreground?.src ?? scene?.foreground ?? "");
/** Netrunner: Netrunner role item / active role, or a Cyberdeck in the inventory. */
export function isNetrunner(actor) {
    if (!actor)
        return false;
    const items = Array.from(actor.items ?? []);
    return items.some(i => String(i.type) === "role" && /netrunner/i.test(String(i.name)))
        || /netrunner/i.test(String(foundry.utils.getProperty(actor, "system.roleInfo.activeRole") ?? ""))
        || items.some(i => String(i.type) === "cyberdeck");
}
/** Scenes in the folder "NET" (including its subfolders). */
export function netScenes() {
    const inNet = (folder) => { for (let f = folder; f; f = f.folder)
        if (NET_FOLDER.test(String(f.name ?? "")))
            return true; return false; };
    return Array.from(game.scenes ?? []).filter(s => inNet(s.folder)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
// ---------- floors ----------
function regionBounds(region) {
    const xs = [], ys = [];
    for (const shape of Array.from(region.shapes ?? [])) {
        const s = shape?.toObject?.() ?? shape;
        if (s.type === "rectangle") {
            xs.push(s.x, s.x + s.width);
            ys.push(s.y, s.y + s.height);
        }
        else if (s.type === "ellipse") {
            xs.push(s.x - s.radiusX, s.x + s.radiusX);
            ys.push(s.y - s.radiusY, s.y + s.radiusY);
        }
        else if (s.type === "circle") {
            xs.push(s.x - s.radius, s.x + s.radius);
            ys.push(s.y - s.radius, s.y + s.radius);
        }
        else if (s.type === "polygon" && Array.isArray(s.points))
            for (let i = 0; i + 1 < s.points.length; i += 2) {
                xs.push(s.points[i]);
                ys.push(s.points[i + 1]);
            }
    }
    if (!xs.length)
        return;
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
const fileLabel = (src) => String(src).startsWith("data:") ? "" : decodeURIComponent(String(src).split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
/** Floors of an architecture: the big tiles (arrows and other small tiles are decoration),
 *  otherwise Drawings / Regions. Sorted left → right, then top → bottom. */
export function floorList(scene) {
    let list = [];
    const tiles = Array.from(scene?.tiles ?? []).filter(t => t.width > 0 && t.height > 0 && t.texture?.src);
    const maxArea = Math.max(0, ...tiles.map(t => t.width * t.height));
    for (const t of tiles)
        if (t.width * t.height >= maxArea * 0.5 && Math.min(t.width, t.height) >= gridOf(scene) * 0.75)
            list.push({ type: "tile", id: t.id, label: fileLabel(t.texture.src) || "Tile", bounds: { x: t.x, y: t.y, width: t.width, height: t.height }, hidden: !!t.hidden });
    if (!list.length) {
        for (const d of Array.from(scene?.drawings ?? [])) {
            const w = Number(d.shape?.width) || 0, h = Number(d.shape?.height) || 0;
            if (w >= 1 && h >= 1)
                list.push({ type: "drawing", id: d.id, label: String(d.text ?? "").trim() || "Drawing", bounds: { x: d.x, y: d.y, width: w, height: h }, hidden: !!d.hidden });
        }
        for (const r of Array.from(scene?.regions ?? [])) {
            const b = regionBounds(r);
            if (b && b.width > 0 && b.height > 0)
                list.push({ type: "region", id: r.id, label: r.name || "Region", bounds: b, hidden: false });
        }
    }
    list = list.sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y));
    list.forEach((f, i) => { f.label = `Floor ${i + 1}: ${f.label}`; });
    return list;
}
/** the Netrunner always starts on the leftmost floor tile */
function entryFloor(scene, _data) {
    return floorList(scene)[0];
}
const centerOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const inside = (b, x, y) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
/** Token position centred on a floor; several Netrunners on one floor are fanned out a little. */
function spotOn(scene, floor, token) {
    const grid = gridOf(scene), w = (token.width || 1) * grid, h = (token.height || 1) * grid;
    const c = centerOf(floor.bounds);
    const others = Array.from(scene.tokens ?? []).filter(t => t.id !== token.id && flagOf(t, RUN_FLAG) && inside(floor.bounds, t.x + (t.width || 1) * grid / 2, t.y + (t.height || 1) * grid / 2)).length;
    const shift = [[0, 0], [-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]][others % 5];
    return { x: Math.round(c.x - w / 2 + shift[0] * floor.bounds.width), y: Math.round(c.y - h / 2 + shift[1] * floor.bounds.height) };
}
/** GM: hide all tiles and tokens to the right of the entry floor (the entry floor and anything left of it,
 *  like the incoming arrow, stay visible). Netrunner copies are never touched. Returns the number hidden. */
async function hideAllButEntry(scene, data) {
    if (!game.user?.isGM || !scene)
        return 0;
    const entry = entryFloor(scene, data);
    if (!entry)
        return 0;
    const edge = entry.bounds.x + entry.bounds.width, grid = gridOf(scene);
    const tiles = Array.from(scene.tiles ?? []).map(t => ({ _id: t.id, hidden: t.x + t.width / 2 > edge, now: !!t.hidden })).filter(u => u.hidden !== u.now);
    const tokens = Array.from(scene.tokens ?? []).filter(t => !flagOf(t, RUN_FLAG))
        .map(t => ({ _id: t.id, hidden: t.x + (t.width || 1) * grid / 2 > edge, now: !!t.hidden })).filter(u => u.hidden !== u.now);
    if (tiles.length)
        await scene.updateEmbeddedDocuments("Tile", tiles.map(({ _id, hidden }) => ({ _id, hidden })));
    if (tokens.length)
        await scene.updateEmbeddedDocuments("Token", tokens.map(({ _id, hidden }) => ({ _id, hidden })));
    return [...tiles, ...tokens].filter(u => u.hidden).length;
}
/** GM: reveal every tile, drawing and token of the architecture (the opposite of the hiding by "Reset Net Arch").
 *  Returns the number revealed. */
async function revealAll(scene) {
    if (!game.user?.isGM || !scene)
        return 0;
    const open = (list) => Array.from(list ?? []).filter(d => d.hidden).map(d => ({ _id: d.id, hidden: false }));
    const tiles = open(scene.tiles), drawings = open(scene.drawings), tokens = open(scene.tokens);
    if (tiles.length)
        await scene.updateEmbeddedDocuments("Tile", tiles);
    if (drawings.length)
        await scene.updateEmbeddedDocuments("Drawing", drawings);
    if (tokens.length)
        await scene.updateEmbeddedDocuments("Token", tokens);
    return tiles.length + drawings.length + tokens.length;
}
// ---------- GM: move Black ICE / Demons floor by floor ----------
const isIce = (token) => ["blackIce", "demon"].includes(String(token?.actor?.type));
/** the floor a Black ICE / Demon belongs to: the one it stands on, otherwise the floor right below it in its column
 *  (with branches several floors share a column) */
function iceFloorIndex(floors, token, grid) {
    const cx = token.x + (token.width || 1) * grid / 2, cy = token.y + (token.height || 1) * grid / 2;
    const column = floors.map((f, i) => ({ f, i })).filter(({ f }) => cx >= f.bounds.x && cx <= f.bounds.x + f.bounds.width);
    if (!column.length)
        return floors.map((f, i) => ({ i, d: Math.hypot(centerOf(f.bounds).x - cx, centerOf(f.bounds).y - cy) })).sort((a, b) => a.d - b.d)[0]?.i ?? -1;
    const on = column.find(({ f }) => inside(f.bounds, cx, cy));
    if (on)
        return on.i;
    const below = column.filter(({ f }) => f.bounds.y >= cy).sort((a, b) => a.f.bounds.y - b.f.bounds.y)[0];
    if (below)
        return below.i;
    return column.sort((a, b) => Math.abs(centerOf(a.f.bounds).y - cy) - Math.abs(centerOf(b.f.bounds).y - cy))[0].i;
}
/** Black ICE / Demons of a floor */
const iceOnFloor = (scene, floors, index) => {
    const grid = gridOf(scene);
    return Array.from(scene.tokens ?? []).filter(t => isIce(t) && iceFloorIndex(floors, t, grid) === index)
        .sort((a, b) => a.x - b.x);
};
const iceOfFloor = (scene, floor) => { const floors = floorList(scene); return iceOnFloor(scene, floors, floors.findIndex(f => f.id === floor.id)); };
/** row of up to three ICE icons, centred above (or wherever they stand on) the floor */
/** Arranges the Black ICE / Demons of a floor above it: one row while they fit across the floor, otherwise a grid
 *  that grows upwards (bottom row at y) – only as high as there is room before the next floor above; when even that
 *  is not enough the icons move closer together. */
function iceLayout(scene, floor, tokens, y) {
    if (!tokens.length)
        return [];
    const grid = gridOf(scene);
    const w = Math.max(...tokens.map(t => (t.width || 1) * grid), grid), h = Math.max(...tokens.map(t => (t.height || 1) * grid), grid);
    const fit = Math.max(1, Math.floor(floor.bounds.width / w));
    // room above: up to the closest floor above in this column (or the top of the scene)
    const above = floorList(scene).filter(f => f.id !== floor.id && f.bounds.y + f.bounds.height <= y + 1
        && f.bounds.x < floor.bounds.x + floor.bounds.width && f.bounds.x + f.bounds.width > floor.bounds.x)
        .reduce((top, f) => Math.max(top, f.bounds.y + f.bounds.height), 0);
    const maxRows = Math.max(1, Math.floor((y + h - above) / h));
    const rows = Math.min(Math.ceil(tokens.length / fit), maxRows), cols = Math.ceil(tokens.length / rows);
    const step = Math.min(w, floor.bounds.width / cols), c = centerOf(floor.bounds).x;
    return tokens.map((t, i) => {
        const row = Math.floor(i / cols), inRow = Math.min(cols, tokens.length - row * cols), col = i - row * cols;
        const width = (t.width || 1) * grid;
        return { _id: t.id, x: Math.round(c + (col - (inRow - 1) / 2) * step - width / 2), y: Math.round(y - row * h) };
    });
}
/** Moves a Black ICE / Demon token one floor left (-1) or right (+1) – any number per floor, arranged above the
 *  tile (see iceLayout); the floor it left is re-arranged too. */
export function moveIceFloor(token, step) {
    return queued(() => moveIceFloorNow(token, step));
}
async function moveIceFloorNow(token, step) {
    if (!game.user?.isGM)
        return;
    const doc = token.document ?? token, scene = doc.parent, grid = gridOf(scene);
    const floors = floorList(scene);
    if (!floors.length)
        return void ui.notifications.warn("This scene has no floors.");
    const from = floors[iceFloorIndex(floors, doc, grid)];
    // one floor left / right in the same row (branches below are separate rows)
    const row = floors.filter(f => sameRow(from, f) && (step > 0 ? f.bounds.x > from.bounds.x : f.bounds.x < from.bounds.x))
        .sort((a, b) => step > 0 ? a.bounds.x - b.bounds.x : b.bounds.x - a.bounds.x);
    if (!row[0])
        return void ui.notifications.warn(`${doc.name} is already on the ${step < 0 ? "first" : "last"} floor of this row.`);
    await placeIce(doc, row[0], step > 0);
}
/** GM: a Black ICE / Demon goes to any floor (right-click a floor → "Move … here") */
export function moveIceToFloor(token, floor) {
    return queued(() => moveIceToFloorNow(token, floor));
}
async function moveIceToFloorNow(token, floor) {
    if (!game.user?.isGM || !floor)
        return;
    const doc = token.document ?? token, scene = doc.parent, floors = floorList(scene);
    const from = floors[iceFloorIndex(floors, doc, gridOf(scene))];
    if (from?.id === floor.id)
        return;
    const to = floors.find(f => f.id === floor.id);
    if (!to)
        return;
    await placeIce(doc, to, !from || centerOf(from.bounds).x <= centerOf(to.bounds).x);
}
/** ICE moves run one after another: each one reads the positions the previous one wrote (fast arrow keys or
 *  several GMs would otherwise arrange from stale positions and stack tokens on top of each other) */
let iceQueue = Promise.resolve();
function queued(fn) {
    const run = iceQueue.then(fn);
    iceQueue = run.catch(() => { });
    return run;
}
const placeIce = (doc, to, fromLeft) => placeIceNow(doc, to, fromLeft);
/** puts a Black ICE / Demon above a floor, next to the ICE already there – the floor it left is re-arranged too */
async function placeIceNow(doc, to, fromLeft) {
    const scene = doc.parent, grid = gridOf(scene);
    await snapshotStart(scene);
    const floors = floorList(scene);
    const index = iceFloorIndex(floors, doc, grid), from = floors[index];
    // floorList() builds new objects every call – find the target floor by id (indexOf never matched: ICE stacked)
    const toIndex = floors.findIndex(f => f.id === to.id);
    if (toIndex < 0)
        return;
    to = floors[toIndex];
    const there = iceOnFloor(scene, floors, toIndex).filter(t => t.id !== doc.id);
    // height (bottom row): like the ICE already there, otherwise the same offset the token had on its old floor
    const bottom = (list) => Math.max(...list.map(t => t.y));
    const old = from ? iceOnFloor(scene, floors, index) : [];
    const y = there.length ? bottom(there) : to.bounds.y + (old.length && from ? bottom(old) - from.bounds.y : -((doc.height || 1) * grid) - grid * 0.2);
    // coming from the left it joins on the left, coming from the right on the right
    const arriving = fromLeft ? [doc, ...there] : [...there, doc];
    const staying = old.filter(t => t.id !== doc.id);
    const updates = [...iceLayout(scene, to, arriving, y), ...(staying.length && from ? iceLayout(scene, from, staying, bottom(old)) : [])];
    await scene.updateEmbeddedDocuments("Token", updates);
}
/** two floors in the same row: the centre of one lies in the other's height */
const sameRow = (a, b) => { const cy = centerOf(b.bounds).y; return cy >= a.bounds.y && cy <= a.bounds.y + a.bounds.height; };
/** The architecture as a tree: every floor's parent (where you come from) and the arrow tiles that lead into it.
 *  Main row: the floor to the left in the same row, with the arrows in between.
 *  Branch: no floor to its left in the row – the arrows in its row lead left to a column of (down) arrows,
 *  which starts below the parent floor. Floors that fit neither keep the old left-to-right order. */
function floorTree(scene) {
    const floors = floorList(scene), grid = gridOf(scene), ids = new Set(floors.map(f => f.id));
    const arrows = Array.from(scene.tiles ?? []).filter(t => !ids.has(t.id) && t.width > 0 && t.height > 0);
    const ac = (t) => ({ x: t.x + t.width / 2, y: t.y + t.height / 2 });
    const tree = new Map();
    const rowArrows = new Map(), lefts = new Map();
    for (const f of floors) {
        const left = floors.filter(g => g !== f && sameRow(f, g) && g.bounds.x + g.bounds.width <= f.bounds.x + 1).sort((a, b) => (b.bounds.x + b.bounds.width) - (a.bounds.x + a.bounds.width))[0];
        const from = left ? left.bounds.x + left.bounds.width : -Infinity;
        lefts.set(f.id, left);
        // arrows pointing into the floor sit around its vertical middle (down arrows passing by do not)
        const mid = centerOf(f.bounds).y, reach = f.bounds.height * 0.3;
        rowArrows.set(f.id, arrows.filter(t => { const c = ac(t); return Math.abs(c.y - mid) <= reach && c.x < f.bounds.x && c.x > from; }));
    }
    const inRows = new Set([...rowArrows.values()].flat().map(t => t.id));
    floors.forEach((f, i) => {
        const row = rowArrows.get(f.id), left = lefts.get(f.id);
        if (left)
            return void tree.set(f.id, { floor: f, parent: left.id, arrows: row.map(t => t.id) });
        if (row.length && i > 0) {
            const first = row.slice().sort((a, b) => ac(a).x - ac(b).x)[0], ax = ac(first).x, tol = Math.max(first.width, first.height, grid) * 0.75;
            const parent = floors.filter(g => g !== f && g.bounds.y + g.bounds.height <= f.bounds.y + 1 && ax >= g.bounds.x - tol && ax <= g.bounds.x + g.bounds.width + tol)
                .sort((a, b) => (b.bounds.y + b.bounds.height) - (a.bounds.y + a.bounds.height))[0];
            if (parent) {
                const column = arrows.filter(t => { const c = ac(t); return !inRows.has(t.id) && Math.abs(c.x - ax) <= tol && c.y > parent.bounds.y + parent.bounds.height - 1 && c.y < centerOf(f.bounds).y; });
                return void tree.set(f.id, { floor: f, parent: parent.id, arrows: [...row, ...column].map(t => t.id) });
            }
        }
        // entry floor (incoming arrow) or a layout without recognisable arrows: previous floor in left-to-right order
        const prev = i > 0 ? floors[i - 1] : undefined;
        const prevRight = prev ? prev.bounds.x + prev.bounds.width : -Infinity;
        const legacy = arrows.filter(t => { const c = ac(t); return c.x > prevRight && c.x < f.bounds.x && c.y >= f.bounds.y && c.y <= f.bounds.y + f.bounds.height; });
        tree.set(f.id, { floor: f, parent: prev?.id, arrows: (row.length ? row : legacy).map(t => t.id) });
    });
    return tree;
}
/** the floors whose edge to the next one is walked forward on the way a → b (up the tree is free, down is checked) */
function forwardSteps(tree, a, b) {
    const up = (id) => { const list = []; const seen = new Set(); let cur = id; while (cur && !seen.has(cur)) {
        seen.add(cur);
        list.push(cur);
        cur = tree.get(cur)?.parent;
    } return list; };
    const fromA = up(a), fromB = up(b);
    const lca = fromB.find(id => fromA.includes(id));
    if (!lca)
        return [];
    const down = fromB.slice(0, fromB.indexOf(lca) + 1).reverse(); // lca … b
    return down.slice(0, -1).map(id => tree.get(id).floor);
}
/** what keeps this Netrunner on the floor (undefined = free). Only what the players can see counts. */
function floorBlockOn(scene, floor, token) {
    const tile = floor.type === "tile" ? scene?.tiles?.get(floor.id) : undefined;
    if (tile && hasPassed(tile, token?.actorId))
        return;
    // only a Password stops the Netrunner – Black ICE attacks or follows, but never holds the way shut
    const ice = [];
    const password = !!tile && floorInfo(tile, []).kinds.has("password");
    if (!ice.length && !password)
        return;
    const gm = !!game.user?.isGM;
    return { floor: floor.label.replace(/:.*/, ""), ice: [...new Set(ice.map(t => gm || !t.hidden ? t.name : "unknown Black ICE"))], password: !ice.length && password, ref: floor };
}
const blockMessage = (b) => b.ice.length
    ? `${b.floor}: ${b.ice.join(", ")} blocks the way – Slide past it first (or derez it).`
    : `${b.floor}: the Password has to be cracked first (Backdoor).`;
const blockReason = (b) => b.ice.length
    ? `Black ICE on ${b.floor} (${b.ice.join(", ")}) – not slid past yet`
    : `the Password on ${b.floor} – not cracked yet (Backdoor)`;
const floorAtPoint = (floors, p) => floors.filter(g => inside(g.bounds, p.x, p.y)).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
/** first block on the way between two floors: every floor left forward (away from the entry, also into a branch) is checked */
function blockBetween(scene, token, from, to, tree = floorTree(scene)) {
    if (from.id === to.id)
        return;
    for (const floor of forwardSteps(tree, from.id, to.id)) {
        const block = floorBlockOn(scene, floor, token);
        if (block)
            return block;
    }
    return;
}
/** first block between two scene points */
function pathBlock(scene, token, from, to) {
    const floors = floorList(scene), a = floorAtPoint(floors, from), b = floorAtPoint(floors, to);
    return a && b ? blockBetween(scene, token, a, b) : undefined;
}
/** GM moves a Netrunner past a block (NET window or dragging it on the NET scene): ask first */
function confirmBlockedMove(doc, changes, options, userId) {
    if (userId !== game.user?.id || !game.user?.isGM || options?.cprnetPathConfirmed)
        return;
    if (!("x" in (changes ?? {})) && !("y" in (changes ?? {})))
        return;
    if (!flagOf(doc, RUN_FLAG))
        return;
    const scene = doc.parent, grid = gridOf(scene), w = (doc.width || 1) * grid / 2, h = (doc.height || 1) * grid / 2;
    const block = pathBlock(scene, doc, { x: doc.x + w, y: doc.y + h }, { x: (changes.x ?? doc.x) + w, y: (changes.y ?? doc.y) + h });
    if (!block)
        return;
    const update = foundry.utils.deepClone(changes);
    delete update._id;
    blockedPrompt(scene, doc, block, () => doc.update(update, { cprnetPathConfirmed: true, animate: options?.animate }));
    return false;
}
/** Path blocked: offer the check that opens it (Backdoor / Slide); the GM may also go on anyway.
 *  The Netrunner first walks up to the blocking floor (the way there is free), then rolls. */
function blockedPrompt(scene, runner, block, proceed) {
    const floor = block.ref, gm = !!game.user?.isGM, grid = gridOf(scene);
    const tile = floor.type === "tile" ? scene.tiles?.get(floor.id) : undefined;
    // all ICE of the floor rolls (a hidden one the Netrunner runs into shows itself on the card)
    const ice = iceOfFloor(scene, floor);
    const fail = (error) => { console.error(MODULE, error); ui.notifications.error(error?.message ?? String(error)); };
    const roll = (action) => void (async () => {
        const c = { x: runner.x + (runner.width || 1) * grid / 2, y: runner.y + (runner.height || 1) * grid / 2 };
        if (!inside(floor.bounds, c.x, c.y))
            await runner.update(spotOn(scene, floor, runner));
        await runNetAction(runner, action, { label: block.floor, tile, ice });
    })().catch(fail);
    const buttons = {};
    if (block.ice.length)
        buttons.slide = { icon: '<i class="fas fa-person-skiing"></i>', label: `Slide past ${block.ice.join(", ")}`, callback: () => roll("slide") };
    else
        buttons.backdoor = { icon: '<i class="fas fa-key"></i>', label: "Backdoor the Password", callback: () => roll("backdoor") };
    if (gm && proceed)
        buttons.proceed = { icon: '<i class="fas fa-forward"></i>', label: "Proceed anyway", callback: () => void Promise.resolve(proceed()).catch(fail) };
    buttons.cancel = { icon: '<i class="fas fa-times"></i>', label: "Cancel" };
    const moveFirst = (() => { const c = { x: runner.x + (runner.width || 1) * grid / 2, y: runner.y + (runner.height || 1) * grid / 2 }; return !inside(floor.bounds, c.x, c.y); })();
    new Dialog({
        title: `${runner.name}: path blocked`,
        content: `<p>Path blocked due to ${esc(blockReason(block))}.</p>`
            + `<p>${block.ice.length ? "Slide: Interface + 1d10 vs the PER + 1d10 of every Black ICE there." : "Backdoor: Interface + 1d10 vs the Password's DV."}`
            + `${moveFirst ? ` ${esc(runner.name)} first moves to ${esc(block.floor)}.` : ""} On a success the way is open.</p>`,
        buttons, default: "cancel",
    }, { classes: ["dialog", "cprnet-net-blocked"] }).render(true);
}
// ---------- GM: Black ICE / Demons in the running combat ----------
/** the encounter a NET token joins: the one of the scene the GM is looking at (the Netrunner's meat-space fight) –
 *  the same one the Combat Tools' combat bar shows (linked to that scene, or unlinked with combatants there) */
function targetCombat() {
    const sceneId = canvas?.scene?.id;
    const all = Array.from(game.combats ?? []);
    const here = sceneId ? all.filter(c => c.scene?.id === sceneId || !c.scene && Array.from(c.combatants ?? []).some(p => p.token?.parent?.id === sceneId)) : [];
    return here.find(c => c.active && c.started) ?? here.find(c => c.active) ?? here.find(c => c.started) ?? here[0]
        ?? (sceneId ? undefined : game.combats?.viewed ?? game.combat ?? undefined);
}
/** open a minimized combat bar on this client – Combat HUD dX if active, otherwise Pneuma's Combat Tools (fork or original) */
async function openCombatBar() {
    for (const id of ["pneuma-combat-hud-dx", "pneuma-combattools"]) {
        if (!game.modules?.get(id)?.active || !game.settings?.settings?.has(`${id}.combatBarMinimized`))
            continue;
        if (game.settings.get(id, "combatBarMinimized"))
            await game.settings.set(id, "combatBarMinimized", false);
        return;
    }
}
/** combatant of this ICE token in any encounter */
function iceCombatant(token) {
    const doc = token.document ?? token, scene = doc.parent;
    for (const combat of Array.from(game.combats ?? []))
        for (const c of Array.from(combat.combatants ?? []))
            if (c.tokenId === doc.id && (c.sceneId ?? combat.scene?.id) === scene?.id)
                return c;
    return undefined;
}
/** like Foundry's "Toggle Combat State": add the token (Black ICE, Demon or Netrunner) to the current encounter or remove it */
async function toggleIceCombat(token) {
    if (!game.user?.isGM)
        return;
    const doc = token.document ?? token, scene = doc.parent;
    const existing = iceCombatant(doc);
    if (existing) {
        await existing.parent.deleteEmbeddedDocuments("Combatant", [existing.id]);
        return void ui.notifications.info(`${doc.name} removed from combat.`);
    }
    let combat = targetCombat();
    if (!combat) {
        // no encounter yet: create one for the scene the GM is on (the meat-space scene of the Access Point)
        combat = await Combat.create({ scene: canvas.scene?.id ?? scene.id, active: true });
    }
    else if (!combat.active)
        await combat.activate(); // the combat bar follows the active encounter of the scene
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: doc.id, sceneId: scene.id, actorId: doc.actorId, hidden: false }]); // visible for everyone
    ui.notifications.info(`${doc.name} added to combat${combat.scene ? ` (${combat.scene.name})` : ""}.`);
    await openCombatBar().catch(error => console.warn(MODULE, "combat bar", error));
}
// ---------- GM: start positions ----------
const START_FLAG = "netStart";
/** remember where every token (ICE, Demons, files …) stands – not the Netrunner copies */
async function snapshotStart(scene, force = false) {
    if (!game.user?.isGM || !scene || (!force && flagOf(scene, START_FLAG)))
        return;
    const start = {};
    for (const t of Array.from(scene.tokens ?? []))
        if (!flagOf(t, RUN_FLAG))
            start[t.id] = { x: t.x, y: t.y };
    await scene.update({ [`flags.${MODULE}.-=${START_FLAG}`]: null });
    await scene.update({ [`flags.${MODULE}.${START_FLAG}`]: start });
}
/** GM ("Reset Net Arch"): removes every player token in the NET scene except the active Netrunners – a token that came in
 *  through an Access Point and whose meat-space token still exists; one per character (the latest). Black ICE, Demons and
 *  tokens without a player owner stay. Returns how many were removed. */
async function removeInactiveRunners(scene) {
    if (!game.user?.isGM || !scene)
        return 0;
    const tokens = Array.from(scene.tokens ?? []);
    const keep = new Map();
    for (const t of tokens) {
        if (!flagOf(t, RUN_FLAG))
            continue;
        const source = flagOf(t, `${RUN_FLAG}.source`);
        if (!source || !fromUuidSync(source))
            continue; // came from a token that no longer exists
        keep.set(String(t.actorId ?? source), t); // later tokens replace earlier ones
    }
    const active = new Set([...keep.values()].map(t => t.id));
    const remove = tokens.filter(t => !active.has(t.id) && !isIce(t) && (flagOf(t, RUN_FLAG) || t.actor?.hasPlayerOwner)).map(t => t.id);
    if (remove.length)
        await scene.deleteEmbeddedDocuments("Token", remove);
    return remove.length;
}
/** a NET scene token without a start position yet (e.g. ICE added after the Access Point was linked):
 *  remember where it stands now, before its first move – so "Reset Net Arch" can bring it back */
const isNetScene = (scene) => !!scene && netScenes().some((n) => n.id === scene.id);
function rememberStart(doc, changes, _options, userId) {
    if (userId !== game.user?.id || !game.user?.isGM || flagOf(doc, RUN_FLAG))
        return;
    if (!("x" in (changes ?? {})) && !("y" in (changes ?? {})))
        return;
    const scene = doc.parent;
    if (!isNetScene(scene))
        return;
    const start = flagOf(scene, START_FLAG);
    if (!start) {
        void snapshotStart(scene).catch(error => console.error(MODULE, error));
        return;
    }
    if (start[doc.id])
        return;
    void scene.update({ [`flags.${MODULE}.${START_FLAG}.${doc.id}`]: { x: doc.x, y: doc.y } }).catch((error) => console.error(MODULE, error));
}
/** all tokens back to their start positions, all Netrunners back to the first floor */
async function resetPositions(scene) {
    if (!game.user?.isGM || !scene)
        return 0;
    await clearPassages(scene); // every Password / Black ICE blocks again
    const start = (flagOf(scene, START_FLAG) ?? {});
    const entry = entryFloor(scene), grid = gridOf(scene);
    const updates = [];
    let runners = 0;
    for (const t of Array.from(scene.tokens ?? [])) {
        if (flagOf(t, RUN_FLAG)) {
            if (!entry)
                continue;
            const w = (t.width || 1) * grid, h = (t.height || 1) * grid, c = centerOf(entry.bounds);
            const shift = [[0, 0], [-0.3, 0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3]][runners++ % 5];
            updates.push({ _id: t.id, x: Math.round(c.x - w / 2 + shift[0] * entry.bounds.width), y: Math.round(c.y - h / 2 + shift[1] * entry.bounds.height), [`flags.${MODULE}.${RUN_FLAG}.iceMet`]: null });
        }
        else if (start[t.id] && (start[t.id].x !== t.x || start[t.id].y !== t.y))
            updates.push({ _id: t.id, ...start[t.id] });
    }
    const changed = updates.filter(u => { const t = scene.tokens.get(u._id); return t && (t.x !== u.x || t.y !== u.y); });
    if (changed.length)
        await scene.updateEmbeddedDocuments("Token", changed, { animate: false });
    return changed.length;
}
// ---------- GM side: create / move / remove the Netrunner token ----------
function netToken(scene, sourceUuid, actorId) {
    const tokens = Array.from(scene.tokens ?? []);
    return tokens.find(t => flagOf(t, `${RUN_FLAG}.source`) === sourceUuid)
        ?? (actorId ? tokens.find(t => t.actorLink && t.actorId === actorId && flagOf(t, RUN_FLAG)) : undefined);
}
/** Black ICE on the floor the Netrunner jacks in to lies in wait right away (after the Jack In has gone through) */
function lyingInWaitAtJackIn(doc) {
    setTimeout(() => void ambushEncounter(doc).catch(error => console.error(MODULE, "NET encounter", error)), 250);
}
async function gmJackIn(request) {
    const user = game.users?.get(request.user);
    const ap = fromUuidSync(request.accessPoint);
    const source = request.source ? fromUuidSync(request.source) : undefined;
    const data = accessPointData(ap);
    if (!user?.active || !data)
        throw Error("This Access Point is not configured.");
    if (!data.enabled && !user.isGM)
        throw Error("This Access Point is locked. The GM has to release it first.");
    if (!source?.actor)
        throw Error("The Netrunner token is no longer available.");
    if (!user.isGM && !source.actor.testUserPermission(user, "OWNER"))
        throw Error("You do not own this Netrunner.");
    const scene = game.scenes?.get(data.scene);
    if (!scene)
        throw Error("The linked NET architecture scene no longer exists.");
    const floor = entryFloor(scene, data);
    if (!floor)
        throw Error(`"${scene.name}" has no floor tiles.`);
    const existing = netToken(scene, source.uuid, source.actorLink ? source.actorId : undefined);
    // never two copies of the same Netrunner in one architecture (e.g. left over from an earlier Jack In)
    const duplicates = Array.from(scene.tokens ?? []).filter(t => t !== existing && flagOf(t, RUN_FLAG)
        && (flagOf(t, `${RUN_FLAG}.source`) === source.uuid || source.actorLink && t.actorLink && t.actorId === source.actorId)).map(t => t.id);
    if (duplicates.length)
        await scene.deleteEmbeddedDocuments("Token", duplicates);
    const run = { source: source.uuid, accessPoint: ap.uuid, user: user.id, stealth: request.stealth && goingQuiet() ? "establishing" : null, stealthSeen: null, iceMet: null };
    if (existing) {
        // Same Access Point: continue on the current floor. Another Access Point: start at its entry floor.
        const same = flagOf(existing, `${RUN_FLAG}.accessPoint`) === ap.uuid;
        await existing.update({ ...(same ? {} : spotOn(scene, floor, existing)), hidden: false, [`flags.${MODULE}.${RUN_FLAG}`]: run }, { animate: false });
        lyingInWaitAtJackIn(existing);
        return existing.id;
    }
    const tokenData = source.toObject();
    delete tokenData._id;
    Object.assign(tokenData, spotOn(scene, floor, { width: source.width, height: source.height }), { hidden: false, elevation: 0 });
    foundry.utils.setProperty(tokenData, `flags.${MODULE}.${RUN_FLAG}`, run);
    if (tokenData.flags?.[MODULE])
        delete tokenData.flags[MODULE].movement; // meat-space movement history stays behind
    const [created] = await scene.createEmbeddedDocuments("Token", [tokenData]);
    lyingInWaitAtJackIn(created);
    return created.id;
}
async function gmJackOut(request) {
    const user = game.users?.get(request.user);
    const data = accessPointData(fromUuidSync(request.accessPoint));
    const token = data ? game.scenes?.get(data.scene)?.tokens?.get(request.token ?? "") : undefined;
    if (!token)
        return;
    if (!user?.isGM && !token.actor?.testUserPermission(user, "OWNER"))
        throw Error("You do not own this Netrunner.");
    // Unsafe Jack Out (DeckKRASH, "Unsafe Jack Out"): first the card with the rezzed Black ICE it met (needs the token)
    let unsafe;
    if (request.unsafe) {
        try {
            unsafe = await postUnsafeCard(token, String(request.reason ?? ""));
        }
        catch (error) {
            console.error(MODULE, "Unsafe Jack Out", error);
        }
    }
    // everything of this run that can still be undone, in one chat card
    try {
        const summary = await postJackOutSummary(token, unsafe);
        await linkUnsafeSummary(unsafe, summary);
    }
    catch (error) {
        console.error(MODULE, "Jack Out summary", error);
    }
    await token.delete();
}
const pending = new Map();
let queue = Promise.resolve();
async function runRequest(request) {
    return request.action === "jack-in" ? gmJackIn(request) : (await gmJackOut(request), undefined);
}
function sendRequest(action, accessPoint, extra) {
    const gm = primaryGM();
    const request = { netrun: "request", id: foundry.utils.randomID(), user: game.user.id, gm: gm?.id ?? "", action, accessPoint, ...extra };
    if (game.user?.isGM)
        return runRequest(request);
    if (!gm)
        return Promise.reject(Error("Jack In needs an active GM."));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(request.id); reject(Error("The GM did not answer. Try again.")); }, 15000);
        pending.set(request.id, { resolve, reject, timer });
        game.socket.emit(CHANNEL, request);
    });
}
// ---------- Going Quiet: stealth state of a Netrunner (written by the primary GM) ----------
/** GM: set the stealth state of a Netrunner token (null: no stealth) */
async function setStealth(doc, state, extra = {}) {
    if (!doc || !flagOf(doc, RUN_FLAG))
        return;
    await doc.update({ [`flags.${MODULE}.${RUN_FLAG}.stealth`]: state, ...(state === "active" ? {} : { [`flags.${MODULE}.${RUN_FLAG}.stealthSeen`]: null }), ...extra });
    if (state === "broken")
        ui.notifications.warn(`${doc.name}: stealth broken – every Watcher in the architecture knows about the Netrunner.`);
}
/** Black ICE / Watchers that already failed to notice the stealthed Netrunner (no new check) */
const stealthSeen = (doc) => (flagOf(doc, `${RUN_FLAG}.stealthSeen`) ?? {});
/** a stealthed Netrunner stands on a floor with Black ICE / Watchers it has not slipped past yet: Evade Detection card */
async function stealthEncounter(doc) {
    if (!isStealthed(doc) || primaryGM()?.id !== game.user?.id)
        return;
    const scene = doc.parent, floor = floorOfDoc(scene, doc);
    if (!floor)
        return;
    const seen = stealthSeen(doc);
    const opponents = iceOfFloor(scene, floor).filter(t => !seen[t.id]);
    if (!opponents.length)
        return;
    // one open card at a time per Netrunner
    const open = Array.from(game.messages ?? []).slice(-40).some(m => {
        const c = foundry.utils.getProperty(m, `flags.${MODULE}.netCard`);
        return c && c.state === "waiting" && c.action === "stealth" && c.scene === scene.id && c.runner?.token === doc.id;
    });
    if (open)
        return;
    await postStealthCard("stealth", doc, { label: floor.label.replace(/:.*/, ""), tile: floor.type === "tile" ? scene.tiles.get(floor.id) : undefined }, opponents);
}
/** Black ICE lying in wait: a (not stealthed) Netrunner enters the floor of Black ICE it has not met yet –
 *  one card for all of them; the GM rolls their SPD, then the Netrunner's Speed check */
const iceMet = (doc) => (flagOf(doc, `${RUN_FLAG}.iceMet`) ?? {});
async function ambushEncounter(doc) {
    if (primaryGM()?.id !== game.user?.id || !flagOf(doc, RUN_FLAG))
        return;
    try {
        if (!game.settings.get(MODULE, "netAutoLyingInWait"))
            return;
    }
    catch {
        return;
    }
    const stealth = stealthOf(doc);
    if (stealth === "active" || stealth === "establishing")
        return; // stealthed: Evade Detection instead
    const scene = doc.parent, floor = floorOfDoc(scene, doc);
    if (!floor)
        return;
    const met = iceMet(doc);
    const ice = iceOfFloor(scene, floor).filter(t => String(t.actor?.type) === "blackIce" && !met[t.id]); // Demons don't lie in wait
    if (!ice.length)
        return;
    await doc.update(Object.fromEntries(ice.map(t => [`flags.${MODULE}.${RUN_FLAG}.iceMet.${t.id}`, true])));
    await postStealthCard("ambush", doc, { label: floor.label.replace(/:.*/, ""), tile: floor.type === "tile" ? scene.tiles.get(floor.id) : undefined }, ice);
}
/** resolved Going Quiet cards (and a taken Control Node) change the Netrunner's stealth */
const stealthDone = new Set();
async function syncStealth(message) {
    if (!goingQuiet() || primaryGM()?.id !== game.user?.id)
        return;
    const s = foundry.utils.getProperty(message, `flags.${MODULE}.netCard`);
    if (!s)
        return;
    const doc = game.scenes?.get(s.scene)?.tokens?.get(s.runner?.token);
    if (!doc)
        return;
    const state = stealthOf(doc);
    // attacking a Black ICE / Demon (Zap, Sword, Banhammer) gives the Netrunner away – hit or miss
    if ((s.type === "rvr" || s.type === "runner-vs-ice" && (s.action === "zap" || s.action === "sword" || s.action === "banhammer")) && s.state !== "cancelled") {
        if (state === "active" && !stealthDone.has(message.id)) {
            stealthDone.add(message.id);
            await setStealth(doc, "broken");
        }
        return;
    }
    if (s.state !== "resolved")
        return;
    // taking possession of a Control Node always breaks stealth
    if (s.type === "check" && s.action === "control" && s.outcome === "success") {
        if (state === "active" && !stealthDone.has(message.id)) {
            stealthDone.add(message.id);
            await setStealth(doc, "broken");
        }
        return;
    }
    const { result, unaware } = stealthResult(s);
    if (!result)
        return;
    const key = `${message.id}:${result}`;
    if (stealthDone.has(key))
        return;
    stealthDone.add(key);
    if (result === "established" && state === "establishing") {
        await setStealth(doc, "active");
        await stealthEncounter(doc);
    }
    else if (result === "failed" && state === "establishing")
        await setStealth(doc, "broken");
    else if (result === "broken" && state === "active")
        await setStealth(doc, "broken");
    else if (result === "maintained" && state === "active" && unaware.length)
        await doc.update(Object.fromEntries(unaware.map(id => [`flags.${MODULE}.${RUN_FLAG}.stealthSeen.${id}`, true])));
}
// GM-Edit: the "Netrunning" button opens a journal (entry or page) – left-click opens it, a right-click of the GM links another one
const NETRUNNING_PAGE = "JournalEntry.2wmh34vKvI4S3MTG.JournalEntryPage.paODQf8AR8AuwhiH";
function netJournalUuid() {
    try {
        return game.settings.get(MODULE, "netRulesJournal") || NETRUNNING_PAGE;
    }
    catch {
        return NETRUNNING_PAGE;
    }
}
function netJournalName() {
    const doc = globalThis.fromUuidSync?.(netJournalUuid());
    return doc ? (doc.documentName === "JournalEntryPage" ? `${doc.parent?.name} › ${doc.name}` : doc.name) : "";
}
const netRulesTitle = () => {
    const name = netJournalName();
    return `Open the journal${name ? ` "${name}"` : ""}${game.user.isGM ? " – right-click: link another journal" : ""}`;
};
async function openNetrunningPage() {
    const doc = await fromUuid(netJournalUuid());
    if (!doc)
        return void ui.notifications.warn(`The linked journal was not found.${game.user.isGM ? " Right-click the button to link another one." : ""}`);
    const isPage = doc.documentName === "JournalEntryPage", entry = isPage ? doc.parent : doc;
    if (!doc.testUserPermission(game.user, "OBSERVER") && !entry?.testUserPermission(game.user, "OBSERVER"))
        return void ui.notifications.warn("You may not view this journal – the GM must give players Observer permission.");
    entry.sheet.render(true, isPage ? { pageId: doc.id } : {});
}
/** GM: choose the journal (or one of its pages) the button opens – from the list, or by dropping it from the sidebar */
async function chooseNetJournal(onChange) {
    if (!game.user.isGM)
        return;
    const current = netJournalUuid();
    const folderPath = (f) => f ? [folderPath(f.folder), f.name].filter(Boolean).join(" › ") : "";
    const entries = [...game.journal].sort((a, b) => a.name.localeCompare(b.name));
    const options = entries.map((e) => {
        const where = folderPath(e.folder);
        const pages = [...e.pages].sort((a, b) => a.sort - b.sort)
            .map((p) => `<option value="${esc(p.uuid)}"${p.uuid === current ? " selected" : ""}>\u00a0\u00a0\u00a0› ${esc(p.name)}</option>`).join("");
        return `<option value="${esc(e.uuid)}"${e.uuid === current ? " selected" : ""} style="font-weight:bold">${esc(e.name)}${where ? ` (${esc(where)})` : ""}</option>${pages}`;
    }).join("");
    const content = `<form class="cprnet-net-journal">
    <p class="notes" style="margin:0 0 6px">Choose the journal or one of its pages – or drop a journal / page from the sidebar here.</p>
    <input type="text" name="search" placeholder="Search …" style="margin-bottom:4px">
    <select name="journal" size="14" style="width:100%;height:auto">${options}</select>
    <p class="notes" style="margin:6px 0 0">Linked now: <b data-current>${esc(netJournalName() || "(not found)")}</b></p>
  </form>`;
    const failed = (error) => ui.notifications.error(String(error?.message ?? error));
    const save = async (uuid) => {
        await game.settings.set(MODULE, "netRulesJournal", uuid === NETRUNNING_PAGE ? "" : uuid);
        onChange();
        ui.notifications.info(`Netrunning button → ${netJournalName() || "journal"}`);
    };
    new Dialog({
        title: "Netrunning button: link a journal",
        content,
        buttons: {
            link: { icon: '<i class="fas fa-link"></i>', label: "Link", callback: (html) => {
                    const uuid = (html[0] ?? html).querySelector("[name=journal]").value;
                    if (uuid)
                        void save(uuid).catch(failed);
                } },
            reset: { icon: '<i class="fas fa-rotate-left"></i>', label: "Default", callback: () => void save(NETRUNNING_PAGE).catch(failed) },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" },
        },
        default: "link",
        render: (html) => {
            const root = html[0] ?? html, select = root.querySelector("[name=journal]");
            const all = [...select.options].map(o => ({ o, text: o.textContent.toLowerCase(), entry: o.value.split(".").slice(0, 2).join(".") }));
            root.querySelector("[name=search]").addEventListener("input", ev => {
                const q = ev.target.value.trim().toLowerCase();
                // a page hit keeps its journal visible, a journal hit shows all its pages
                const hit = new Set(all.filter(x => !q || x.text.includes(q)).map(x => x.o.value));
                const entriesShown = new Set(all.filter(x => hit.has(x.o.value)).map(x => x.entry));
                for (const x of all)
                    x.o.hidden = !(hit.has(x.o.value) || hit.has(x.entry) || (x.o.value === x.entry && entriesShown.has(x.entry)));
            });
            select.addEventListener("dblclick", () => root.closest(".app")?.querySelector(".dialog-button.link")?.click());
            root.addEventListener("dragover", ev => ev.preventDefault());
            root.addEventListener("drop", ev => {
                ev.preventDefault();
                let data;
                try {
                    data = JSON.parse(ev.dataTransfer?.getData("text/plain") ?? "");
                }
                catch {
                    return;
                }
                if (!["JournalEntry", "JournalEntryPage"].includes(data?.type) || !data.uuid)
                    return void ui.notifications.warn("Drop a journal or a journal page here.");
                if (![...select.options].some(o => o.value === data.uuid))
                    return void ui.notifications.warn("That journal is not in this world (compendium journals cannot be linked).");
                select.value = data.uuid;
                root.querySelector("[data-current]").textContent = select.selectedOptions[0]?.textContent?.trim() ?? "";
            });
            select.selectedOptions[0]?.scrollIntoView({ block: "center" });
        },
    }, { width: 460 }).render(true);
}
const views = new Map();
/** height of the GM button row in the NET window footer (row + gap, see .cprnet-netview-row.is-gm) */
const GM_ROW = 30;
class NetView extends Application {
    ap;
    tokenId;
    data; // tokenId "" = spectator view (no own Netrunner)
    view;
    userZoomed = false;
    /** the token this window acts with (left-click / Tab): a Netrunner, for the GM also a Black ICE / Demon */
    activeId;
    constructor(ap, tokenId) {
        super();
        this.ap = ap;
        this.tokenId = tokenId;
        this.activeId = tokenId || "";
        this.data = accessPointData(ap);
    }
    static get defaultOptions() {
        // players have no GM button row: the window is that much lower, the map keeps the same size as the GM's
        return foundry.utils.mergeObject(super.defaultOptions, { classes: ["cprnet-netview"], width: 900, height: game.user?.isGM ? 360 : 360 - GM_ROW, resizable: true, popOut: true, minimizable: true });
    }
    get id() { return this.tokenId ? `cprnet-netview-${this.tokenId}` : `cprnet-netview-view-${this.data.scene}`; }
    get title() { return `NET — ${this.scene?.name ?? "?"}`; }
    get scene() { return game.scenes?.get(this.data.scene); }
    get token() { return this.tokenId ? this.scene?.tokens?.get(this.tokenId) : undefined; }
    // ---------- the active token ----------
    /** who may be made active: the GM every Netrunner and Black ICE / Demon, a player only his own Netrunners */
    canControl(t) {
        if (!t || (!game.user?.isGM && t.hidden))
            return false;
        if (game.user?.isGM)
            return isRunnerToken(t) || isIce(t);
        return isRunnerToken(t) && !!t.isOwner;
    }
    get active() {
        const t = this.activeId ? this.scene?.tokens?.get(this.activeId) : undefined;
        if (t && this.canControl(t))
            return t;
        // a player's own Netrunner is active by default
        if (!game.user?.isGM) {
            const own = this.token ?? Array.from(this.scene?.tokens ?? []).find(x => isRunnerToken(x) && x.isOwner);
            if (own)
                this.activeId = own.id;
            return own;
        }
        return undefined;
    }
    activeRunner() { const a = this.active; return a && isRunnerToken(a) ? a : undefined; }
    /** every token this user can make active, in reading order (Tab) */
    controllable() {
        return Array.from(this.scene?.tokens ?? []).filter(t => this.canControl(t)).sort((a, b) => (a.x - b.x) || (a.y - b.y));
    }
    setActive(id) {
        if (this.activeId === id)
            return;
        this.activeId = id;
        this.renderFooter();
        this.draw();
    }
    cycleActive(step) {
        const list = this.controllable();
        if (!list.length)
            return;
        const i = list.findIndex(t => t.id === this.activeId);
        const next = list[((i < 0 ? (step > 0 ? -1 : 0) : i) + step + list.length) % list.length];
        this.setActive(next.id);
    }
    // ---------- window ----------
    async _renderInner() {
        const root = document.createElement("div");
        root.className = "cprnet-netview-body";
        root.innerHTML = `<div class="cprnet-netview-stage" tabindex="0" aria-label="NET architecture"><div class="cprnet-netview-world"></div><span class="cprnet-netview-keys" aria-hidden="true"><i class="fas fa-keyboard"></i> Keys control the NET</span></div>
      <footer class="cprnet-netview-footer"></footer>`;
        return $(root);
    }
    footerHTML() {
        // Concept D: row 1 always the same (active token · floor ‹ › · NET Actions · status slot · ? · rules · overview ·
        // Jack Out), row 2 only for the GM (Show · Save Start | Reset · Unplug all). Nothing shifts any more: controls that
        // do not apply right now are greyed out instead of disappearing, the status slot keeps its width.
        const gm = !!game.user?.isGM, active = this.active, runner = active && isRunnerToken(active) ? active : undefined;
        const hint = ["Click a token: make it active (Tab: next)", "click a floor or use the arrow keys: move the active Netrunner", "right-click a token: actions", gm ? "right-click a floor: floor settings" : "", "double-click: sheet", "wheel: zoom · drag: pan"].filter(Boolean).join("\n");
        const max = runner ? netActionsLimit(runner) : 0;
        const off = runner ? "" : " disabled";
        const canJackOut = !!runner && (gm || runner.isOwner);
        return `<div class="cprnet-netview-row">
        <span class="cprnet-netview-active${active ? "" : " is-none"}" title="${active ? `Active: ${esc(active.name)} – left-click another token (or Tab) to switch` : "No active token – left-click a token (or press Tab)"}">${active ? `<img src="${esc(tokenImg(active))}" alt="">` : `<i class="fas fa-hand-pointer"></i>`}<span><small>Active</small>${active ? esc(active.name) : "–"}</span></span>
        <button type="button" data-net-step="-1" title="Previous floor"${off}><i class="fas fa-chevron-left"></i></button>
        <button type="button" data-net-step="1" title="Next floor"${off}><i class="fas fa-chevron-right"></i></button>
        <span class="cprnet-netview-actions${max && netActionsOf(runner) > max ? " is-over" : ""}${runner ? "" : " is-off"}" title="${runner ? `${esc(runner.name)}: NET Actions used this round (Interface 1–3: 2 · 4–6: 3 · 7–9: 4 · 10: 5) – back to 0 at every new round` : "NET Actions – make a Netrunner active"}">
          NET Actions <button type="button" data-net-act="-1" title="One less"${off}><i class="fas fa-caret-down"></i></button><span data-net-act-value>${runner ? netActionsHTML(runner) : "–"}</span><button type="button" data-net-act="1" title="One more"${off}><i class="fas fa-caret-up"></i></button></span>
        <span class="cprnet-netview-status"><span class="cprnet-netview-stealth" data-net-stealth hidden></span><span class="cprnet-netview-nostatus" data-net-nostatus>no status</span></span>
        <span class="cprnet-netview-spacer"></span>
        <button type="button" class="cprnet-netview-icon" data-net-help title="${esc(hint)}" aria-label="Controls"><i class="fas fa-question"></i></button>
        <button type="button" class="cprnet-netview-icon" data-net-rules title="${esc(netRulesTitle())}" aria-label="Netrunning rules"><i class="fas fa-book-open"></i></button>
        <button type="button" class="cprnet-netview-icon" data-net-fit title="Overview: fit the whole architecture" aria-label="Overview"><i class="fas fa-expand"></i></button>
        <button type="button" class="cprnet-netview-jackout" data-net-jackout title="${canJackOut ? `${esc(runner.name)}: Jack Out` : "Jack Out – make your Netrunner active"}"${canJackOut ? "" : " disabled"}><i class="fas fa-plug-circle-xmark"></i> Jack Out</button>
        </div>
        ${gm ? `<div class="cprnet-netview-row is-gm"><span class="cprnet-netview-gmlabel">GM</span>
        <button type="button" class="cprnet-netview-gm" data-net-show title="Open this NET architecture window for all players"><i class="fas fa-users"></i> Show to Players</button>
        <button type="button" class="cprnet-netview-gm" data-net-reveal title="Reveal everything: every floor, arrow, drawing, Black ICE and Demon of this architecture becomes visible (&quot;Reset Net Arch&quot; hides it again)"><i class="fas fa-eye"></i> Reveal everything</button>
        <button type="button" class="cprnet-netview-gm" data-net-savestart title="Save the current positions of all Black ICE / Demons as the start for &quot;Reset Net Arch&quot;"><i class="fas fa-floppy-disk"></i> Save Start</button>
        <span class="cprnet-netview-sep"></span>
        <button type="button" class="cprnet-netview-gm" data-net-start title="Reset the architecture: all Black ICE / Demons back to their start positions, all Netrunners back to the first floor, every Password blocks again, every Black ICE / Demon has full REZ, inactive player tokens are removed and everything except the first floor is hidden"><i class="fas fa-rotate-left"></i> Reset Net Arch</button>
        <button type="button" class="cprnet-netview-gm" data-net-unplug title="Kick every player token out of this NET architecture: each Netrunner jacks out (with its Jack Out summary), every other player token is removed – only Black ICE and Demons stay"><i class="fas fa-plug-circle-minus"></i> Unplug all Netrunners</button>
        </div>` : ""}`;
    }
    /** the footer follows the active token (drawn again whenever it changes) */
    renderFooter() {
        const root = this.element?.[0], footer = root?.querySelector(".cprnet-netview-footer");
        if (!footer)
            return;
        footer.innerHTML = this.footerHTML();
        const report = (error) => ui.notifications.error(String(error?.message ?? error));
        footer.querySelectorAll("[data-net-step]").forEach(b => b.addEventListener("click", () => void this.stepOrder(Number(b.dataset.netStep)).catch(report)));
        const rules = footer.querySelector("[data-net-rules]");
        rules?.addEventListener("click", () => void openNetrunningPage().catch(report));
        rules?.addEventListener("contextmenu", event => {
            event.preventDefault();
            if (!game.user.isGM)
                return;
            void chooseNetJournal(() => { rules.title = netRulesTitle(); }).catch(report);
        });
        footer.querySelector("[data-net-help]")?.addEventListener("click", (event) => ui.notifications.info(event.currentTarget.title.replace(/\n/g, " · ")));
        footer.querySelector("[data-net-fit]")?.addEventListener("click", () => { this.userZoomed = false; this.view = undefined; this.draw(); });
        footer.querySelector("[data-net-jackout]")?.addEventListener("click", () => { const r = this.activeRunner(); if (r)
            void this.jackOut(r); });
        footer.querySelectorAll("[data-net-act]").forEach(button => button.addEventListener("click", () => {
            const token = this.activeRunner();
            if (!token)
                return;
            const next = Math.max(0, netActionsOf(token) + Number(button.dataset.netAct));
            void token.update({ [`flags.${MODULE}.${ACTIONS_FLAG}`]: next }).catch(report);
        }));
        // Reset Net Arch: positions first (the ICE is back above its own floor), then hide all but the first floor
        footer.querySelector("[data-net-start]")?.addEventListener("click", () => void (async () => {
            const removed = await removeInactiveRunners(this.scene); // old copies / stray player tokens
            const moved = await resetPositions(this.scene);
            const hidden = await hideAllButEntry(this.scene, this.data);
            const healed = await restoreRez(this.scene); // every Black ICE / Demon back to full REZ
            ui.notifications.info(`NET Architecture reset: ${removed} inactive player token(s) removed, ${moved} token(s) back at their start positions, ${healed} Black ICE / Demon(s) back to full REZ, ${hidden} tile(s) / token(s) hidden – only the first floor is visible.`);
        })().catch(report));
        // GM: everyone out – Netrunners jack out (their summaries are posted), other player tokens are removed; ICE stays
        footer.querySelector("[data-net-unplug]")?.addEventListener("click", () => void (async () => {
            const tokens = Array.from(this.scene?.tokens ?? []).filter(t => !isIce(t) && (flagOf(t, RUN_FLAG) || t.actor?.hasPlayerOwner));
            if (!tokens.length)
                return void ui.notifications.info("No player tokens in this NET architecture.");
            const ok = await Dialog.confirm({ title: "Unplug all Netrunners?", defaultYes: false,
                content: `<p>Kick every player token out of this NET architecture?</p><p>${tokens.map(t => esc(t.name)).join(", ")}</p><p>Netrunners jack out (each gets its Jack Out summary), other player tokens are removed. Black ICE and Demons stay.</p>` });
            if (!ok)
                return;
            let out = 0;
            for (const token of tokens.filter(t => flagOf(t, RUN_FLAG))) {
                try {
                    await sendRequest("jack-out", flagOf(token, `${RUN_FLAG}.accessPoint`) ?? this.ap.uuid, { token: token.id });
                    out++;
                }
                catch (error) {
                    console.error(MODULE, "Unplug all", token.name, error);
                }
            }
            // what is left: stray player tokens (and Netrunners whose Jack Out failed)
            const rest = tokens.map(t => t.id).filter(id => this.scene.tokens.get(id));
            if (rest.length)
                await this.scene.deleteEmbeddedDocuments("Token", rest);
            ui.notifications.info(`Unplugged: ${out} Netrunner(s) jacked out${rest.length ? `, ${rest.length} other player token(s) removed` : ""}.`);
        })().catch(report));
        // GM: the current positions become the start ("Reset Net Arch" goes back here)
        footer.querySelector("[data-net-savestart]")?.addEventListener("click", () => void (async () => {
            const ok = await Dialog.confirm({ title: "Save start positions?", content: "<p>Save the current positions of all Black ICE / Demons in this NET architecture as the start?</p><p>\"Reset Net Arch\" will bring them back here. Netrunners always restart on the first floor.</p>", defaultYes: true });
            if (!ok)
                return;
            await snapshotStart(this.scene, true);
            const n = Object.keys((flagOf(this.scene, START_FLAG) ?? {})).length;
            ui.notifications.info(`Start positions saved for ${n} token(s).`);
        })().catch(report));
        footer.querySelector("[data-net-reveal]")?.addEventListener("click", () => void revealAll(this.scene).then(n => ui.notifications.info(n ? `Revealed ${n} hidden element(s) of this NET architecture.` : "Everything is already visible.")).catch(report));
        footer.querySelector("[data-net-show]")?.addEventListener("click", () => {
            game.socket.emit(CHANNEL, { netrun: "show", accessPoint: this.ap.uuid, gm: game.user.id });
            ui.notifications.info("NET architecture window opened for all players.");
        });
        this.drawStealth();
    }
    activateListeners(html) {
        super.activateListeners(html);
        const root = html[0];
        const stage = root.querySelector(".cprnet-netview-stage");
        const report = (error) => ui.notifications.error(String(error?.message ?? error));
        // click = make a token active / move the active Netrunner, drag = pan
        let drag;
        stage.addEventListener("pointerdown", event => {
            if (event.button !== 0 || !this.view)
                return;
            drag = { x: event.clientX, y: event.clientY, offX: this.view.offX, offY: this.view.offY, moved: false };
            stage.setPointerCapture(event.pointerId);
        });
        stage.addEventListener("pointermove", event => {
            if (drag && this.view) {
                const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
                if (!drag.moved && Math.hypot(dx, dy) < 5)
                    return;
                drag.moved = true;
                this.userZoomed = true;
                this.view.offX = drag.offX + dx;
                this.view.offY = drag.offY + dy;
                this.applyView();
                return;
            }
            this.hover(event);
        });
        stage.addEventListener("pointerup", event => {
            const was = drag;
            drag = undefined;
            if (was && !was.moved)
                void this.clickAt(event).catch(report);
        });
        stage.addEventListener("wheel", event => {
            if (!this.view)
                return;
            event.preventDefault();
            const rect = stage.getBoundingClientRect(), mx = event.clientX - rect.left, my = event.clientY - rect.top;
            const factor = Math.exp(-event.deltaY * 0.0015), scale = Math.min(8, Math.max(0.02, this.view.scale * factor));
            const k = scale / this.view.scale;
            this.view = { scale, offX: mx - (mx - this.view.offX) * k, offY: my - (my - this.view.offY) * k };
            this.userZoomed = true;
            this.draw();
        }, { passive: false });
        // keys: only while the NET view has the focus – and then they stay here (not passed on to the battlemap).
        // All other keys (WASD, Space, Delete …) still go to Foundry as usual.
        stage.addEventListener("keydown", event => {
            if (event.key === "Tab") {
                event.preventDefault();
                event.stopPropagation();
                return this.cycleActive(event.shiftKey ? -1 : 1);
            }
            const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (!dir)
                return;
            event.preventDefault();
            event.stopPropagation();
            const active = this.active;
            if (active && isIce(active)) {
                if (dir[0] && !event.repeat) // held key: one floor per press
                    void moveIceFloor(active, dir[0]).catch(report);
                return;
            }
            void this.stepDirection(dir[0], dir[1]).catch(report);
        });
        stage.addEventListener("keyup", event => { if (event.key === "Tab" || event.key.startsWith("Arrow"))
            event.stopPropagation(); });
        if (game.user?.isGM)
            void snapshotStart(this.scene).catch(report); // views of older Access Points: current positions become the start
        // double-click a token: its character sheet (rolls from there)
        stage.addEventListener("dblclick", event => {
            const p = this.scenePoint(event), token = p ? this.tokenAt(p.x, p.y) : undefined;
            if (!token?.actor)
                return;
            if (!token.actor.testUserPermission(game.user, "LIMITED"))
                return void ui.notifications.warn(`You may not view ${token.name}.`);
            token.actor.sheet?.render(true);
        });
        // right-click: a token – the active token's actions against it; a floor – the GM's floor settings
        stage.addEventListener("contextmenu", event => {
            event.preventDefault();
            const p = this.scenePoint(event);
            if (!p)
                return;
            const token = this.tokenAt(p.x, p.y);
            if (token)
                return this.tokenMenu(event, token, report);
            if (!game.user?.isGM)
                return;
            const floor = this.floorAt(p.x, p.y), tile = this.tileAt(p.x, p.y);
            if (floor || tile)
                this.floorMenu(event, floor, tile, report);
        });
        stage.addEventListener("pointerdown", event => { if (!event.target.closest(".cprnet-netview-menu"))
            this.closeMenu(); }, true);
        new ResizeObserver(() => { if (!this.userZoomed)
            this.view = undefined; this.draw(); }).observe(stage);
        this.renderFooter();
        this.draw();
        stage.focus();
    }
    /** Everything that is drawn: tiles, drawings, tokens (players: visible only). */
    contentBounds() {
        const scene = this.scene, gm = !!game.user?.isGM, grid = gridOf(scene);
        const xs = [], ys = [];
        const add = (x, y, w, h) => { xs.push(x, x + w); ys.push(y, y + h); };
        for (const t of Array.from(scene.tiles ?? []))
            if (gm || !t.hidden)
                add(t.x, t.y, t.width, t.height);
        for (const d of Array.from(scene.drawings ?? []))
            if (gm || !d.hidden)
                add(d.x, d.y, Number(d.shape?.width) || 0, Number(d.shape?.height) || 0);
        for (const t of Array.from(scene.tokens ?? []))
            if (gm || !t.hidden)
                add(t.x, t.y, (t.width || 1) * grid, (t.height || 1) * grid);
        if (!xs.length) {
            const d = scene.dimensions;
            return d ? { x: d.sceneX, y: d.sceneY, width: d.sceneWidth, height: d.sceneHeight } : undefined;
        }
        const pad = grid * 0.6, x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
        return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
    }
    fit(stage) {
        const b = this.contentBounds();
        if (!b || !stage.clientWidth || !stage.clientHeight)
            return;
        const scale = Math.min(stage.clientWidth / b.width, stage.clientHeight / b.height) || 1;
        this.view = { scale, offX: (stage.clientWidth - b.width * scale) / 2 - b.x * scale, offY: (stage.clientHeight - b.height * scale) / 2 - b.y * scale };
    }
    applyView() {
        const world = this.element?.[0]?.querySelector(".cprnet-netview-world");
        if (world && this.view)
            world.style.transform = `translate(${this.view.offX}px, ${this.view.offY}px) scale(${this.view.scale})`;
    }
    /** many document changes at once (Reveal everything, Reset Net Arch …) → one redraw in the next frame */
    scheduleDraw() {
        if (this._drawFrame)
            return;
        this._drawFrame = requestAnimationFrame(() => { this._drawFrame = 0; this.draw(); });
    }
    draw() {
        if (this._drawFrame) {
            cancelAnimationFrame(this._drawFrame);
            this._drawFrame = 0;
        }
        const root = this.element?.[0];
        const stage = root?.querySelector(".cprnet-netview-stage"), world = root?.querySelector(".cprnet-netview-world");
        if (!stage || !world)
            return;
        const scene = this.scene;
        if (!scene) {
            world.style.transform = "";
            world.innerHTML = `<p class="cprnet-netview-error">The NET scene is not available to you. The GM must give players at least Observer permission for it.</p>`;
            return;
        }
        if (!this.view)
            this.fit(stage);
        const gm = !!game.user?.isGM, grid = gridOf(scene);
        const dims = scene.dimensions ?? scene.getDimensions?.();
        const box = (x, y, w, h) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
        const parts = [];
        // scene as Foundry draws it: background colour, background image, tiles, drawings, tokens, overhead tiles, foreground.
        // Background on its own layer, rebuilt only when it changes – an animated .webm keeps playing while tokens move.
        const baseHTML = !dims ? "" : `<div class="cprnet-netview-fill" style="${box(0, 0, dims.width, dims.height)};background:${esc(scene.backgroundColor || "#000")}"></div>`
            + (backgroundOf(scene) ? media(backgroundOf(scene), "cprnet-netview-bg", box(dims.sceneX, dims.sceneY, dims.sceneWidth, dims.sceneHeight)) : "");
        let base = world.querySelector(":scope > .cprnet-netview-base"), layer = world.querySelector(":scope > .cprnet-netview-layer");
        if (!base || !layer) {
            world.innerHTML = `<div class="cprnet-netview-base"></div><div class="cprnet-netview-layer"></div>`;
            base = world.querySelector(":scope > .cprnet-netview-base");
            layer = world.querySelector(":scope > .cprnet-netview-layer");
        }
        if (base.dataset.key !== baseHTML) {
            base.dataset.key = baseHTML;
            base.innerHTML = baseHTML;
        }
        const fgElevation = Number(scene.foregroundElevation ?? Infinity);
        const tiles = Array.from(scene.tiles ?? []).filter(t => (gm || !t.hidden) && t.texture?.src).sort((a, b) => (a.elevation - b.elevation) || (a.sort - b.sort));
        const tileHTML = (t) => {
            const sx = Number(t.texture?.scaleX ?? 1) || 1, sy = Number(t.texture?.scaleY ?? 1) || 1;
            const style = `${box(t.x, t.y, t.width, t.height)};opacity:${t.hidden ? 0.5 : t.alpha ?? 1};transform:rotate(${t.rotation || 0}deg) scale(${Math.sign(sx)},${Math.sign(sy)})`;
            return media(t.texture.src, "cprnet-netview-tile", style);
        };
        for (const t of tiles.filter(t => !(t.elevation >= fgElevation)))
            parts.push(tileHTML(t));
        for (const d of Array.from(scene.drawings ?? []).filter(d => gm || !d.hidden))
            parts.push(drawingSVG(d));
        // which floors this Netrunner can enter (green) and which lie behind a Password / Black ICE (red lock)
        parts.push(this.accessHTML(gm));
        // hover highlight for the floor under the mouse (set in hover())
        parts.push(`<div class="cprnet-netview-hover" hidden></div>`);
        const tokens = Array.from(scene.tokens ?? []).filter(t => gm || !t.hidden).sort((a, b) => (a.elevation - b.elevation) || ((a.sort ?? 0) - (b.sort ?? 0)));
        for (const t of tokens) {
            let src = String(t.texture?.src ?? "");
            if (!src || src.includes("*"))
                src = t.actor?.img ?? "icons/svg/mystery-man.svg";
            const sx = Number(t.texture?.scaleX ?? 1) || 1, sy = Number(t.texture?.scaleY ?? 1) || 1;
            const own = isRunnerToken(t) && t.isOwner && !game.user?.isGM, act = t.id === this.activeId && this.canControl(t);
            // Going Quiet: stealthed Netrunners are drawn "cloaked" (see-through, scanning ring, badge)
            const stealth = flagOf(t, RUN_FLAG) ? stealthOf(t) : undefined;
            const stealthClass = stealth === "active" ? " is-stealth" : stealth === "establishing" ? " is-stealth-pending" : "";
            const badge = stealth === "active" || stealth === "establishing" ? `<span class="cprnet-netview-stealth-badge" title="${stealth === "active" ? "Stealthed" : "Jacking In quietly"}"><i class="fas fa-user-secret"></i></span>` : "";
            parts.push(`<div class="cprnet-netview-token${own ? " is-own" : ""}${act ? " is-active" : ""}${this.canControl(t) ? " is-controllable" : ""}${stealthClass}${t.hidden ? " is-hidden" : ""}" data-token="${t.id}" title="${esc(t.name)}${stealth === "active" ? " – stealthed" : ""}"
        style="${box(t.x, t.y, (t.width || 1) * grid, (t.height || 1) * grid)};opacity:${t.hidden ? 0.5 : t.alpha ?? 1}"><img src="${esc(src)}" alt="" style="transform:rotate(${t.rotation || 0}deg) scale(${sx},${sy})">${badge}</div>`);
        }
        for (const t of tiles.filter(t => t.elevation >= fgElevation))
            parts.push(tileHTML(t));
        if (dims && foregroundOf(scene))
            parts.push(media(foregroundOf(scene), "cprnet-netview-bg", box(dims.sceneX, dims.sceneY, dims.sceneWidth, dims.sceneHeight)));
        // rebuild the layer only when something in it changed (tiles can be videos – re-creating them is expensive)
        const html = parts.join("");
        if (this._layerHTML !== html || !layer.childElementCount && html) {
            this._layerHTML = html;
            layer.innerHTML = html;
        }
        this.applyView();
        this.drawStealth();
    }
    /** Going Quiet: status chip in the footer and a frame around the whole view while the own Netrunner is stealthed */
    drawStealth() {
        const root = this.element?.[0];
        const chip = root?.querySelector("[data-net-stealth]");
        if (!root || !chip)
            return;
        const runner = this.activeRunner();
        const state = runner ? stealthOf(runner) : undefined;
        const text = { active: "Stealth", establishing: "Jacking in quietly …", broken: "Detected" };
        const icon = { active: "fa-user-secret", establishing: "fa-hourglass-half", broken: "fa-eye" };
        const tip = { active: "Stealthed: Black ICE and Watchers have to notice the Netrunner first (Evade Detection).",
            establishing: "Quiet Jack In: the Interface check against the Watchers is still open (chat card).",
            broken: "Stealth broken: Watchers know about the Netrunner, Black ICE reacts as usual. Jack Out and Jack In quietly again to re-establish it." };
        chip.hidden = !state;
        const none = root.querySelector("[data-net-nostatus]");
        if (none)
            none.hidden = !!state;
        chip.className = `cprnet-netview-stealth${state ? ` is-${state}` : ""}`;
        chip.title = state ? `${runner.name}: ${tip[state]}` : "";
        chip.innerHTML = state ? `<i class="fas ${icon[state]}" aria-hidden="true"></i> ${esc(text[state])}${` <small>${esc(runner.name)}</small>`}` : "";
        root.classList.toggle("is-stealthed", state === "active");
        root.classList.toggle("is-stealth-broken", state === "broken");
    }
    /** reachability overlay per floor for the own Netrunner (GM: the one in this window, otherwise the first one) */
    accessHTML(gm) {
        const scene = this.scene, runner = this.activeRunner();
        if (!scene || !runner)
            return "";
        const floors = floorList(scene), grid = gridOf(scene);
        const c = { x: runner.x + (runner.width || 1) * grid / 2, y: runner.y + (runner.height || 1) * grid / 2 };
        const current = floorAtPoint(floors, c);
        if (!current)
            return "";
        const here = floors.indexOf(current), tree = floorTree(scene);
        return floors.map((f, i) => {
            const block = blockBetween(scene, runner, current, f, tree);
            if (!gm && f.hidden)
                return "";
            const b = f.bounds, size = Math.max(10, Math.round(Math.min(b.width, b.height) * 0.075));
            const style = `left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;--access-size:${size}px`;
            if (i === here)
                return `<div class="cprnet-netview-access is-here" style="${style}"></div>`;
            const locked = !!block;
            const label = locked ? (block.ice.length ? `Slide past ${block.ice.join(", ")}` : `Backdoor the Password`) + (block.floor !== f.label.replace(/:.*/, "") ? ` (${block.floor})` : "") : "";
            return `<div class="cprnet-netview-access ${locked ? "is-locked" : "is-open"}${f.hidden ? " is-hidden" : ""}" style="${style}" title="${esc(locked ? `${runner.name} cannot enter: ${blockReason(block)}` : `${runner.name} can enter this floor`)}">`
                + `<span class="cprnet-netview-access-badge"><i class="fas ${locked ? "fa-lock" : "fa-lock-open"}"></i>${locked ? `<small>${esc(label)}</small>` : ""}</span></div>`;
        }).join("");
    }
    scenePoint(event) {
        const stage = this.element?.[0]?.querySelector(".cprnet-netview-stage");
        if (!stage || !this.view)
            return;
        const rect = stage.getBoundingClientRect();
        return { x: (event.clientX - rect.left - this.view.offX) / this.view.scale, y: (event.clientY - rect.top - this.view.offY) / this.view.scale };
    }
    floors() { return floorList(this.scene).filter(f => game.user?.isGM || !f.hidden); }
    floorAt(x, y) {
        return this.floors().filter(f => inside(f.bounds, x, y)).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
    }
    currentFloor() {
        return this.floorOfToken(this.activeRunner());
    }
    hover(event) {
        const marker = this.element?.[0]?.querySelector(".cprnet-netview-hover");
        const p = this.scenePoint(event);
        if (!marker || !p)
            return;
        const over = this.tokenAt(p.x, p.y), runner = this.activeRunner();
        const stage = this.element?.[0]?.querySelector(".cprnet-netview-stage");
        if (stage)
            stage.style.cursor = (over && this.canControl(over)) || (!over && runner) ? "pointer" : "default";
        const floor = runner && !over ? this.floorAt(p.x, p.y) : undefined;
        marker.hidden = !floor;
        if (floor)
            Object.assign(marker.style, { left: `${floor.bounds.x}px`, top: `${floor.bounds.y}px`, width: `${floor.bounds.width}px`, height: `${floor.bounds.height}px` });
    }
    /** the active Netrunner goes to a floor */
    async moveTo(floor) {
        const token = this.activeRunner();
        if (!token)
            return;
        if (!token.isOwner)
            throw Error(`You do not own ${token.name}.`);
        const current = this.floorOfToken(token);
        if (!floor || floor.id === current?.id)
            return;
        // Superglue: no going deeper while it holds (the GM may go on anyway)
        const glue = glueOf(token);
        if (glue && current && floorDepth(this.scene, floor) > floorDepth(this.scene, current)) {
            if (!game.user?.isGM)
                return void ui.notifications.warn(`${token.name} is held by Superglue (${glue.rounds} round${glue.rounds === 1 ? "" : "s"} left) and can't go deeper.`);
            if (!await Dialog.confirm({ title: "Superglue", content: `<p>${esc(token.name)} is held by Superglue (${glue.rounds} round(s) left).</p><p>Move deeper anyway?</p>`, defaultYes: false }))
                return;
        }
        // players: a Password has to be cracked (Backdoor), Black ICE slid past (Slide), before going further
        const grid = gridOf(this.scene), w = (token.width || 1) * grid / 2, h = (token.height || 1) * grid / 2;
        const block = game.user?.isGM ? undefined : pathBlock(this.scene, token, { x: token.x + w, y: token.y + h }, centerOf(floor.bounds));
        if (block)
            return void blockedPrompt(this.scene, token, block);
        await token.update(spotOn(this.scene, floor, token));
    }
    floorBlock(floor, token) {
        const block = floorBlockOn(this.scene, floor, token);
        return block ? blockMessage(block) : "";
    }
    /** left-click: a token becomes active (if this user may act with it) – a floor: the active Netrunner goes there.
     *  An active Black ICE / Demon is never moved by a click (GM: right-click the floor → "Move … here"). */
    async clickAt(event) {
        const p = this.scenePoint(event);
        if (!p)
            return;
        const token = this.tokenAt(p.x, p.y);
        if (token) {
            if (this.canControl(token))
                this.setActive(token.id);
            return;
        }
        if (this.activeRunner())
            await this.moveTo(this.floorAt(p.x, p.y));
    }
    /** topmost visible token / tile under a scene point */
    tokenAt(x, y) {
        const gm = !!game.user?.isGM, grid = gridOf(this.scene);
        return Array.from(this.scene?.tokens ?? []).filter(t => (gm || !t.hidden) && x >= t.x && y >= t.y && x <= t.x + (t.width || 1) * grid && y <= t.y + (t.height || 1) * grid)
            .sort((a, b) => (b.elevation - a.elevation) || ((b.sort ?? 0) - (a.sort ?? 0)))[0];
    }
    tileAt(x, y) {
        const gm = !!game.user?.isGM;
        return Array.from(this.scene?.tiles ?? []).filter(t => (gm || !t.hidden) && x >= t.x && y >= t.y && x <= t.x + t.width && y <= t.y + t.height)
            .sort((a, b) => (b.elevation - a.elevation) || ((b.sort ?? 0) - (a.sort ?? 0)))[0];
    }
    /** ‹ back to the floor you came from · › on to the next floor (the main row first, otherwise the topmost branch) */
    async stepOrder(step) {
        const floors = this.floors(), current = this.currentFloor();
        if (!current)
            return this.moveTo(floors[0]);
        const tree = floorTree(this.scene), visible = new Set(floors.map(f => f.id));
        if (step < 0) {
            const parent = tree.get(current.id)?.parent;
            return this.moveTo(parent && visible.has(parent) ? tree.get(parent).floor : undefined);
        }
        const children = [...tree.values()].filter(n => n.parent === current.id && visible.has(n.floor.id)).map(n => n.floor)
            .sort((a, b) => (Number(!sameRow(current, a)) - Number(!sameRow(current, b))) || (a.bounds.y - b.bounds.y) || (a.bounds.x - b.bounds.x));
        await this.moveTo(children[0]);
    }
    /** nearest floor in an arrow direction */
    async stepDirection(dx, dy) {
        const current = this.currentFloor();
        if (!current)
            return this.stepOrder(dx || dy);
        const c = centerOf(current.bounds);
        const best = this.floors().filter(f => f.id !== current.id).map(f => {
            const o = centerOf(f.bounds), vx = o.x - c.x, vy = o.y - c.y, along = vx * dx + vy * dy;
            return { f, along, score: along + Math.abs(vx * dy - vy * dx) * 2 };
        }).filter(r => r.along > 0).sort((a, b) => a.score - b.score)[0];
        await this.moveTo(best?.f);
    }
    closeMenu() { this.element?.[0]?.querySelector(".cprnet-netview-menu")?.remove(); }
    /** small context menu at the mouse position */
    showMenu(event, title, items, report, note = "") {
        this.closeMenu();
        const body = this.element?.[0]?.querySelector(".cprnet-netview-body");
        if (!body || !items.length)
            return;
        const rect = body.getBoundingClientRect();
        const menu = document.createElement("div");
        menu.className = "cprnet-netview-menu";
        const html = (item, i) => item.separator ? `<hr>`
            : item.section ? `<span class="cprnet-netview-menu-section">${esc(item.label)}</span>`
            : item.text ? `<span class="cprnet-netview-menu-cell" title="${esc(item.title ?? "")}">${esc(item.label)}${item.sub ? `<small>${esc(item.sub)}</small>` : ""}</span>`
                : `<button type="button" data-item="${i}" class="${item.active ? "active" : ""}${item.disabled ? " is-disabled" : ""}"${item.disabled ? " disabled" : ""} title="${esc(item.title ?? "")}" aria-label="${esc(item.title || item.label)}">${!item.label ? `<i class="fas ${item.icon}"></i>` : item.iconAfter ? `${esc(item.label)} <i class="fas ${item.icon}"></i>` : `<i class="fas ${item.icon}"></i> ${esc(item.label)}`}</button>`;
        // items sharing a "row" key sit side by side in one line
        // consecutive "matrix…" rows share one grid, so their columns line up
        let content = "", inMatrix = false;
        for (let i = 0; i < items.length; i++) {
            const row = items[i].row, matrix = !!row?.startsWith("matrix");
            if (matrix && !inMatrix) {
                content += `<div class="cprnet-netview-menu-matrix">`;
                inMatrix = true;
            }
            if (!matrix && inMatrix) {
                content += `</div>`;
                inMatrix = false;
            }
            if (!row) {
                content += html(items[i], i);
                continue;
            }
            let group = "";
            for (; i < items.length && items[i].row === row; i++)
                group += html(items[i], i);
            i--;
            content += `<div class="cprnet-netview-menu-row${matrix ? " is-matrix" : ""}${row === "matrix:head" ? " is-head" : ""}">${group}</div>`;
        }
        if (inMatrix)
            content += `</div>`;
        menu.innerHTML = `<strong>${esc(title)}</strong>${note ? `<small>${esc(note)}</small>` : ""}` + content;
        menu.addEventListener("contextmenu", e => e.preventDefault());
        menu.querySelectorAll("[data-item]").forEach(button => button.addEventListener("click", e => {
            e.stopPropagation();
            this.closeMenu();
            void Promise.resolve(items[Number(button.dataset.item)].run?.()).catch(report);
        }));
        // extreme case (many ICE on one floor): never taller than the window – scrolls vertically, scrollbar only when needed
        menu.style.maxHeight = `${Math.max(120, rect.height - 8)}px`;
        body.append(menu);
        // close on any click outside the menu or with Escape
        const outside = (e) => { if (!menu.isConnected)
            return cleanup(); if (!menu.contains(e.target)) {
            menu.remove();
            cleanup();
        } };
        const escape = (e) => { if (e.key === "Escape") {
            menu.remove();
            cleanup();
        } };
        const cleanup = () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); };
        setTimeout(() => { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape, true); }, 0);
        // keep it inside the window
        const x = Math.min(event.clientX - rect.left, rect.width - menu.offsetWidth - 4), y = Math.min(event.clientY - rect.top, rect.height - menu.offsetHeight - 4);
        menu.style.left = `${Math.max(4, x)}px`;
        menu.style.top = `${Math.max(4, y)}px`;
    }
    revealItem(doc) {
        return { label: doc.hidden ? "Reveal for players" : "Hide from players", icon: doc.hidden ? "fa-eye" : "fa-eye-slash", run: () => doc.update({ hidden: !doc.hidden }) };
    }
    floorOfToken(token) {
        const grid = gridOf(this.scene);
        return token ? this.floorAt(token.x + (token.width || 1) * grid / 2, token.y + (token.height || 1) * grid / 2) : undefined;
    }
    iceInColumn(floor) {
        return this.scene ? iceOfFloor(this.scene, floor).filter(t => game.user?.isGM || !t.hidden) : [];
    }
    /** the floor a token is on – Black ICE / Demons stand above their floor */
    floorOfAny(t) {
        if (!t)
            return undefined;
        if (!isIce(t))
            return this.floorOfToken(t);
        const floors = floorList(this.scene), i = iceFloorIndex(floors, t, gridOf(this.scene));
        return i >= 0 ? floors[i] : undefined;
    }
    sameFloor(a, b) {
        const fa = this.floorOfAny(a), fb = this.floorOfAny(b);
        return !!fa && !!fb && fa.id === fb.id;
    }
    /** right-click a token: what the active token can do with it ("Rufus → Wisp") */
    tokenMenu(event, token, report) {
        const gm = !!game.user?.isGM;
        let active = this.active;
        // nobody active yet: a token the user may act with becomes active right away
        if (!active && this.canControl(token)) {
            this.setActive(token.id);
            active = token;
        }
        if (!active) {
            if (gm)
                return this.showMenu(event, token.name, [...(isRunnerToken(token) ? [this.combatItem(token)] : []), this.revealItem(token)], report, "No active token – left-click a token first");
            return this.showMenu(event, token.name, [{ label: "Left-click your Netrunner first", icon: "fa-hand-pointer", disabled: true }], report);
        }
        if (active.id === token.id)
            return isIce(token) ? this.iceSelfMenu(event, token, report) : this.runnerSelfMenu(event, token, report);
        if (isRunnerToken(active) && isIce(token))
            return this.runnerIceMenu(event, active, token, report);
        if (isRunnerToken(active) && isRunnerToken(token))
            return this.runnerRunnerMenu(event, active, token, report);
        if (isIce(active) && isRunnerToken(token))
            return this.iceRunnerMenu(event, active, token, report);
        const items = [{ label: `${active.name} can't act against ${token.name}`, icon: "fa-ban", disabled: true }];
        if (gm)
            items.push({ separator: true, label: "", icon: "" }, this.revealItem(token));
        this.showMenu(event, `${active.name} → ${token.name}`, items, report);
    }
    /** the active Netrunner on itself: what it can do on its floor, Interface abilities, Jack Out */
    runnerSelfMenu(event, token, report) {
        const gm = !!game.user?.isGM;
        const floor = this.floorOfToken(token);
        const label = floor?.label.replace(/:.*/, "") ?? "NET";
        const tile = floor?.type === "tile" ? this.scene.tiles.get(floor.id) : undefined;
        const ice = floor ? this.iceInColumn(floor) : [];
        const items = [];
        let note = label;
        if (tile) {
            const info = floorInfo(tile, ice);
            note += ` · ${[...info.kinds].filter(k => k !== "empty").map(k => FLOOR_KINDS[k]).join(", ") || "no content"}${info.dv !== null ? ` · DV${info.dv}` : ""}`;
            // floor actions only – everything against Black ICE / Demons: right-click them
            for (const action of actionsForKinds(info.kinds, token.actor, isStealthed(token)).filter(a => ["backdoor", "eyedee", "control"].includes(a.id)))
                items.push({ label: action.label, icon: action.icon, title: action.hint, run: () => runNetAction(token, action.id, { label, tile, ice }) });
        }
        items.push(...RUNNER_ACTIONS.map(action => ({ label: action.label, icon: action.icon, title: action.hint, run: () => runNetAction(token, action.id, { label, tile, ice }) })));
        // Going Quiet – GM: set / end the stealth by hand (e.g. an alarm in meat space)
        if (gm && goingQuiet()) {
            const state = stealthOf(token);
            items.push({ separator: true, label: "", icon: "" }, state === "active"
                ? { label: "Break stealth", icon: "fa-eye", title: "Stealth ends – every Watcher knows about the Netrunner", run: () => setStealth(token, "broken") }
                : { label: "Set stealthed", icon: "fa-user-secret", title: "The Netrunner counts as stealthed (e.g. after a successful Quiet Jack In rolled at the table)", run: () => setStealth(token, "active") });
        }
        if (gm || token.isOwner)
            items.push({ separator: true, label: "", icon: "" }, { label: "Jack Out", icon: "fa-plug-circle-xmark", run: () => this.jackOut(token) },
                { label: "Unsafe Jack Out", icon: "fa-plug-circle-exclamation", title: "Out at once, without a NET Action (also while Superglued) – the Netrunner suffers the effect of every rezzed Black ICE it met", run: () => this.jackOut(token, true) });
        if (gm)
            items.push(this.combatItem(token), this.revealItem(token));
        this.showMenu(event, `${token.name}`, items, report, note);
    }
    /** GM: like Foundry's "Toggle Combat State" – this token (Netrunner or ICE) in / out of the current encounter */
    combatItem(token) {
        const inCombat = !!iceCombatant(token);
        return { label: "Toggle Combat State", icon: "fa-swords", active: inCombat, title: `${token.name}: ${inCombat ? "in combat – click to remove" : "not in combat – click to add"}`, run: () => toggleIceCombat(token) };
    }
    /** GM: the active Black ICE / Demon on itself */
    iceSelfMenu(event, token, report) {
        this.showMenu(event, token.name, [
            { label: "", icon: "fa-arrow-left", title: "One floor left", row: "move", run: () => moveIceFloor(token, -1) },
            { label: "", icon: "fa-arrow-right", title: "One floor right", row: "move", run: () => moveIceFloor(token, 1) },
            this.combatItem(token),
            { separator: true, label: "", icon: "" },
            this.revealItem(token),
        ], report, `${token.hidden ? "hidden from players" : "visible to players"} · right-click a floor: move it there`);
    }
    /** the active Netrunner against a Black ICE / Demon: attacks on exactly this one, Slide, the Speed reaction */
    runnerIceMenu(event, runner, iceToken, report) {
        const gm = !!game.user?.isGM;
        const floor = this.floorOfToken(runner);
        const label = floor?.label.replace(/:.*/, "") ?? "NET";
        const tile = floor?.type === "tile" ? this.scene.tiles.get(floor.id) : undefined;
        const all = floor ? this.iceInColumn(floor) : [];
        const here = this.sameFloor(runner, iceToken);
        const why = here ? "" : `${iceToken.name} is not on ${runner.name}'s floor`;
        const demon = String(iceToken.actor?.type) === "demon", stealthed = isStealthed(runner);
        const kinds = new Set([demon ? "demon" : "ice"]);
        const items = [];
        for (const action of actionsForKinds(kinds, runner.actor, stealthed).filter(a => a.id !== "pathfinder")) {
            // attacks: only this target · Slide / Speed / Evade Detection: every ICE of the floor takes part
            const target = ["zap", "sword", "banhammer"].includes(action.id) ? [iceToken] : all;
            const reaction = ["speed", "stealth"].includes(action.id);
            items.push({ label: action.label + (reaction ? " (reaction)" : ""), icon: action.icon, title: why || action.hint, disabled: !here,
                run: () => runNetAction(runner, action.id, { label, tile, ice: target }) });
        }
        if (gm)
            items.push({ separator: true, label: "", icon: "" }, this.revealItem(iceToken));
        this.showMenu(event, `${runner.name} → ${iceToken.name}`, items, report, why || (demon ? "Demon" : "Black ICE"));
    }
    /** GM: the active Black ICE / Demon against a Netrunner on its floor */
    iceRunnerMenu(event, iceToken, runner, report) {
        const floor = this.floorOfToken(runner);
        const label = floor?.label.replace(/:.*/, "") ?? "NET";
        const here = this.sameFloor(iceToken, runner);
        const why = here ? "" : `${runner.name} is not on ${iceToken.name}'s floor`;
        const stealthed = isStealthed(runner), demon = String(iceToken.actor?.type) === "demon";
        // Going Quiet: a stealthed Netrunner is not met with SPD (lying in wait) – Watchers can search instead
        const actions = ICE_ACTIONS.filter(a => a.stealth ? stealthed : !(stealthed && a.stat === "spd")).filter(a => !((demon && !a.demon) || (!demon && a.only === "demon")));
        const items = actions.map(a => ({ label: a.label, icon: a.icon, title: why || a.hint, disabled: !here, run: () => startIceAction(iceToken, runner, a.stat, label) }));
        if (!items.length)
            items.push({ label: "Nothing to do", icon: "fa-ban", disabled: true });
        items.push({ separator: true, label: "", icon: "" }, this.combatItem(runner), this.revealItem(runner));
        this.showMenu(event, `${iceToken.name} → ${runner.name}`, items, report, why || (stealthed ? `${runner.name} is stealthed` : ""));
    }
    /** the active Netrunner against another Netrunner: Zap, Anti-Personnel programs, attacks on its programs */
    runnerRunnerMenu(event, runner, target, report) {
        const here = this.sameFloor(runner, target);
        const floor = this.floorOfToken(runner);
        const label = floor?.label.replace(/:.*/, "") ?? "NET";
        const hidden = !game.user?.isGM && isStealthed(target);
        const why = !here ? `${target.name} is not on ${runner.name}'s floor` : hidden ? `${target.name} is stealthed` : "";
        const items = runnerAttackItems(runner, target, label, why);
        if (game.user?.isGM)
            items.push({ separator: true, label: "", icon: "" }, this.combatItem(target), this.revealItem(target));
        this.showMenu(event, `${runner.name} → ${target.name}`, items, report, why || "Netrunner");
    }
    /** GM: right-click a floor – move the active Black ICE / Demon here, floor type / DV, passage, reveal */
    floorMenu(event, floor, tile, report) {
        const items = [], active = this.active;
        const tileFloor = floor?.type === "tile" ? this.scene.tiles.get(floor.id) : undefined;
        const theTile = tileFloor ?? tile;
        let title = floor ? floor.label.replace(/:.*/, "") : "Tile", note = "";
        if (active && isIce(active) && floor) {
            const already = this.floorOfAny(active)?.id === floor.id;
            items.push({ label: `Move ${active.name} here`, icon: "fa-arrows-up-down-left-right", disabled: already, title: already ? `${active.name} is already on this floor` : `${active.name} goes to this floor (arranged above it)`, run: () => moveIceToFloor(active, floor) });
            items.push({ separator: true, label: "", icon: "" });
        }
        if (tileFloor) {
            const info = floorInfo(tileFloor, this.iceInColumn(floor));
            note = `${[...info.kinds].map(k => FLOOR_KINDS[k]).join(", ") || "unknown type"}${info.dv !== null ? ` · DV${info.dv}` : ""}${passageOpen(tileFloor) ? " · passage open" : ""}`;
            items.push({ label: "Floor type / DV …", icon: "fa-sliders", run: () => configureFloor(tileFloor) }, { label: passageOpen(tileFloor) ? "Close passage" : "Open passage", icon: passageOpen(tileFloor) ? "fa-lock" : "fa-lock-open",
                title: "Lets every Netrunner go on past this floor without Backdoor / Slide", run: () => togglePassage(tileFloor) });
        }
        if (theTile)
            items.push(this.revealItem(theTile));
        this.showMenu(event, title, items, report, note);
    }
    async jackOut(token, unsafe = false) {
        if (!token)
            return;
        if (unsafe) {
            const met = iceMetOnCards(token);
            const ok = await Dialog.confirm({ title: "Unsafe Jack Out", defaultYes: false,
                content: `<p>Jack ${esc(token.name)} out <strong>unsafely</strong>?</p><p>${met.length ? `The Netrunner suffers the effect of every rezzed Black ICE it met: ${met.map(t => esc(t.name)).join(", ")}.` : "No rezzed Black ICE met – no effects."}</p>` });
            if (!ok)
                return;
        }
        // Superglue: no safe Jack Out while it holds (the GM may go on anyway) – an unsafe one is always possible
        const glue = unsafe ? undefined : glueOf(token);
        if (glue) {
            if (!game.user?.isGM)
                return void ui.notifications.warn(`${token.name} is held by Superglue (${glue.rounds} round${glue.rounds === 1 ? "" : "s"} left) – no safe Jack Out.`);
            if (!await Dialog.confirm({ title: "Superglue", content: `<p>${esc(token.name)} is held by Superglue (${glue.rounds} round(s) left) – no safe Jack Out.</p><p>Jack Out anyway?</p>`, defaultYes: false }))
                return;
        }
        try {
            await sendRequest("jack-out", this.ap.uuid, { token: token.id, ...(unsafe ? { unsafe: true, reason: "Unsafe Jack Out" } : {}) });
            ui.notifications.info(`${token.name} jacked out of the NET${unsafe ? " (unsafe)" : ""}.`);
            if (token.id === this.tokenId)
                await this.close();
        }
        catch (error) {
            ui.notifications.error(error.message);
        }
    }
    async close(options) {
        views.delete(this.tokenId || `view-${this.data.scene}`);
        return super.close(options);
    }
}
/** a Netrunner token in a NET scene */
const isRunnerToken = (t) => !!flagOf(t, RUN_FLAG);
const tokenImg = (t) => String(t?.texture?.src && !String(t.texture.src).includes("*") ? t.texture.src : t?.actor?.img ?? "icons/svg/mystery-man.svg");
/** how deep a floor lies in the architecture (number of floors before it) */
function floorDepth(scene, floor) {
    const tree = floorTree(scene);
    let depth = 0;
    for (let id = floor?.id; id && tree.get(id)?.parent && depth < 500; id = tree.get(id).parent)
        depth++;
    return depth;
}
function drawingSVG(d) {
    const w = Number(d.shape?.width) || 0, h = Number(d.shape?.height) || 0;
    if (w < 1 || h < 1)
        return "";
    const stroke = d.strokeWidth ? `stroke="${esc(d.strokeColor ?? "#fff")}" stroke-width="${d.strokeWidth}" stroke-opacity="${d.strokeAlpha ?? 1}"` : `stroke="none"`;
    const fill = d.fillType ? `fill="${esc(d.fillColor ?? "#000")}" fill-opacity="${d.fillAlpha ?? 0.5}"` : `fill="none"`;
    let shape = "";
    if (d.shape.type === "r")
        shape = `<rect x="0" y="0" width="${w}" height="${h}" ${fill} ${stroke}/>`;
    else if (d.shape.type === "e")
        shape = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${fill} ${stroke}/>`;
    else if (Array.isArray(d.shape.points) && d.shape.points.length > 3)
        shape = `<polyline points="${d.shape.points.join(" ")}" ${fill} ${stroke}/>`;
    const text = String(d.text ?? "").trim();
    const label = text ? `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" fill="${esc(d.textColor ?? "#fff")}" font-size="${d.fontSize ?? 48}" font-family="${esc(d.fontFamily ?? "Signika")}">${esc(text)}</text>` : "";
    if (!shape && !label)
        return "";
    return `<svg class="cprnet-netview-drawing${d.hidden ? " is-hidden" : ""}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="left:${d.x}px;top:${d.y}px;width:${w}px;height:${h}px;transform:rotate(${d.rotation || 0}deg)">${shape}${label}</svg>`;
}
function openView(ap, tokenId) {
    const data = accessPointData(ap);
    if (!data)
        return;
    const key = tokenId || `view-${data.scene}`;
    const existing = views.get(key);
    if (existing) {
        existing.ap = ap;
        existing.data = data;
        existing.render(true);
        existing.bringToTop();
        return;
    }
    const view = new NetView(ap, tokenId);
    views.set(key, view);
    view.render(true);
}
/** the view a user should get: his own Netrunner in that architecture, otherwise a spectator view */
function openForMe(ap) {
    const data = accessPointData(ap);
    const scene = data ? game.scenes?.get(data.scene) : undefined;
    if (!scene)
        return void ui.notifications.warn("The NET architecture scene is not available to you – the GM must give players Observer permission.");
    const own = Array.from(scene.tokens ?? []).find(t => flagOf(t, RUN_FLAG) && t.isOwner && (game.user?.isGM ? flagOf(t, `${RUN_FLAG}.user`) === game.user?.id : true));
    openView(ap, own?.id ?? "");
}
const redrawScene = (sceneId) => { for (const view of views.values())
    if (!sceneId || view.data.scene === sceneId)
        view.scheduleDraw(); };
/** Access Point settings changed (e.g. window background) → open windows follow */
const refreshAccessPoint = (doc) => {
    for (const view of views.values())
        if (view.ap?.id === doc?.id) {
            const data = accessPointData(doc);
            if (data) {
                view.ap = doc;
                view.data = data;
                view.draw();
            }
        }
};
// ---------- Jack In / configuration ----------
async function jackIn(ap) {
    if (!accessPointData(ap.document))
        return void ui.notifications.warn("This token is not an Access Point.");
    const controlled = (canvas.tokens?.controlled ?? []);
    const runner = controlled.find(t => t !== ap && t.actor?.isOwner && isNetrunner(t.actor)) ?? controlled.find(t => t !== ap && t.actor?.isOwner);
    if (!runner)
        return void ui.notifications.warn("Select your Netrunner token first, then right-click the Access Point.");
    if (!isNetrunner(runner.actor))
        return void ui.notifications.warn(`${runner.name} is not a Netrunner (no Netrunner role and no Cyberdeck).`);
    // Going Quiet: Jack In normally (1 NET Action) or quietly (2 NET Actions)
    let stealth = false;
    if (goingQuiet()) {
        const mode = await chooseJackInMode(runner.name);
        if (!mode)
            return;
        stealth = mode === "stealth";
    }
    const tokenId = await sendRequest("jack-in", ap.document.uuid, { source: runner.document.uuid, stealth });
    if (!tokenId)
        throw Error("Jack In failed.");
    openView(ap.document, tokenId);
    // Jack In is a NET Action – quietly it takes two
    const netToken = game.scenes?.get(accessPointData(ap.document)?.scene)?.tokens?.get(tokenId);
    await spendNetActions(netToken, stealth ? 2 : 1);
    if (stealth)
        await quietJackIn(ap.document, tokenId);
}
function chooseJackInMode(name) {
    return new Promise(resolve => new Dialog({
        title: `${name}: Jack In`,
        content: `<p class="cprnet-jackin-mode">How does <strong>${esc(name)}</strong> jack in?</p>`
            + `<p class="notes">Stealth: the Netrunner rolls Interface + 1d10 against every Watcher (Demons, enemy Netrunners) in the architecture – beat them all to enter undetected.</p>`,
        buttons: {
            normal: { icon: '<i class="fas fa-network-wired"></i>', label: "Normal (1 Action)", callback: () => resolve("normal") },
            stealth: { icon: '<i class="fas fa-user-secret"></i>', label: "Stealth (2 Actions)", callback: () => resolve("stealth") },
        },
        default: "normal", close: () => resolve(null),
    }, { classes: ["dialog", "cprnet-jackin-dialog"] }).render(true));
}
/** Watchers of an architecture: Demons and enemy Netrunners (not the players' own) */
function watchersOf(scene) {
    return Array.from(scene?.tokens ?? []).filter(t => !flagOf(t, RUN_FLAG) && t.actor
        && (String(t.actor.type) === "demon" || (String(t.actor.type) !== "blackIce" && !t.actor.hasPlayerOwner && isNetrunner(t.actor))));
}
/** Quiet Jack In: the card with one row per Watcher (none: stealth is established right away) */
async function quietJackIn(ap, tokenId) {
    const data = accessPointData(ap), scene = data ? game.scenes?.get(data.scene) : undefined;
    const runner = scene?.tokens?.get(tokenId);
    if (!runner)
        return;
    const floor = floorOfDoc(scene, runner);
    await postStealthCard("quietjack", runner, { label: floor?.label.replace(/:.*/, "") ?? "Jack In", tile: floor?.type === "tile" ? scene.tiles.get(floor.id) : undefined }, watchersOf(scene));
}
const floorOfDoc = (scene, doc) => {
    const grid = gridOf(scene);
    return floorAtPoint(floorList(scene), { x: doc.x + (doc.width || 1) * grid / 2, y: doc.y + (doc.height || 1) * grid / 2 });
};
async function configure(token) {
    const current = accessPointData(token.document);
    const net = netScenes();
    const scenes = net.length ? net : Array.from(game.scenes ?? []).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!scenes.length)
        return void ui.notifications.warn("There are no scenes.");
    const selected = scenes.some(s => s.id === current?.scene) ? current.scene : scenes[0].id;
    const sceneOptions = scenes.map(s => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    const content = `<form class="cprnet-ap-config"><p>Link <strong>${esc(token.name)}</strong> to a NET architecture.</p>
    ${net.length ? "" : `<p class="notes" style="color:#c66">No scene folder named "NET" found – showing all scenes.</p>`}
    <div class="form-group"><label>NET architecture</label><select name="scene">${sceneOptions}</select></div>
    <p class="notes" data-floor-note></p></form>`;
    const fill = (html) => {
        const floors = floorList(game.scenes?.get(html.querySelector("[name=scene]").value));
        html.querySelector("[data-floor-note]").textContent = floors.length
            ? `${floors.length} floor(s) found. The Netrunner always starts on the leftmost floor.` : "This scene has no floor tiles yet.";
    };
    const buttons = {
        save: { icon: '<i class="fas fa-check"></i>', label: current ? "Save" : "Make Access Point", callback: async (html) => {
                const form = html[0];
                const scene = form.querySelector("[name=scene]").value;
                await token.document.update({ [`flags.${MODULE}.${AP_FLAG}`]: { scene, enabled: !!current?.enabled } });
                // new architecture: remember the start positions; everything beyond the first floor starts hidden
                if (current?.scene !== scene) {
                    await snapshotStart(game.scenes?.get(scene), true);
                    const n = await hideAllButEntry(game.scenes?.get(scene), { scene });
                    if (n)
                        ui.notifications.info(`${n} tile(s) / token(s) beyond the first floor are hidden. Right-click them in the NET view to reveal.`);
                }
                ui.notifications.info(`${token.name} is now an Access Point.`);
            } },
    };
    if (current)
        buttons.remove = { icon: '<i class="fas fa-trash"></i>', label: "Remove Access Point", callback: async () => {
                await token.document.update({ [`flags.${MODULE}.-=${AP_FLAG}`]: null });
                ui.notifications.info(`${token.name} is no longer an Access Point.`);
            } };
    buttons.cancel = { icon: '<i class="fas fa-times"></i>', label: "Cancel" };
    new Dialog({
        title: "Access Point", content, buttons, default: "save",
        render: (html) => { const form = html[0]; fill(form); form.querySelector("[name=scene]").addEventListener("change", () => fill(form)); },
    }).render(true);
}
/** GM: release / lock an Access Point for the players */
async function toggleRelease(token, hud) {
    const data = accessPointData(token.document);
    if (!game.user?.isGM || !data)
        return;
    const enabled = !data.enabled;
    await token.document.update({ [`flags.${MODULE}.${AP_FLAG}.enabled`]: enabled });
    ui.notifications.info(`${token.name}: ${enabled ? "released – players can jack in" : "locked – players cannot jack in"}.`);
    if (hud?.object === token)
        hud.render?.(true);
}
/** Token HUD: GM plug icon (make / configure Access Point) and the network "Jack In" icon on Access Points. */
function decorateHUD(hud, html) {
    const token = hud.object;
    if (!token)
        return;
    const ap = isAccessPoint(token);
    if (!ap && !game.user?.isGM)
        return;
    // GM-Edit: players can only jack in after the GM has released this Access Point
    const released = !!accessPointData(token.document)?.enabled;
    if (ap && !released && !game.user?.isGM)
        return;
    const place = (attempt = 0) => {
        if (hud.object !== token)
            return;
        const root = html[0];
        // Combat Tools adds its column asynchronously – wait a few frames for it, otherwise use the native right column
        const column = root.querySelector(".pneuma-combat-column") ?? (attempt < 6 ? null : root.querySelector(".col.right"));
        if (!column) {
            if (attempt < 6)
                requestAnimationFrame(() => place(attempt + 1));
            return;
        }
        if (root.querySelector("[data-cprnet-netrun]"))
            return;
        const icon = (action, cls, title) => {
            const el = document.createElement("div");
            el.className = "control-icon cprnet-netrun-icon";
            el.setAttribute("role", "button");
            el.tabIndex = 0;
            el.dataset.cprnetNetrun = action;
            el.title = title;
            el.setAttribute("aria-label", title);
            el.innerHTML = `<i class="fas ${cls}" aria-hidden="true"></i>`;
            const run = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const go = action === "jack-in" ? jackIn(token) : action === "view" ? openForMe(token.document)
                    : action === "toggle-lock" ? toggleRelease(token, hud)
                        : action === "ice-left" ? moveIceFloor(token, -1) : action === "ice-right" ? moveIceFloor(token, 1) : configure(token);
                void Promise.resolve(go).catch(error => ui.notifications.error(error.message ?? String(error)));
                if (!["configure", "ice-left", "ice-right", "toggle-lock"].includes(action))
                    hud.clear?.();
            };
            el.addEventListener("click", run);
            el.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ")
                run(event); });
            return el;
        };
        if (ap)
            column.append(icon("jack-in", "fa-network-wired", "Jack In"));
        if (ap && game.user?.isGM) {
            const lock = icon("toggle-lock", released ? "fa-lock-open" : "fa-lock", released ? "Released for players – click to lock" : "Locked for players – click to release");
            lock.classList.toggle("active", released);
            column.append(lock);
        }
        if (game.user?.isGM && isIce(token) && floorList(token.document.parent).length) {
            column.append(icon("ice-left", "fa-arrow-left", "Move one floor left"), icon("ice-right", "fa-arrow-right", "Move one floor right"));
        }
        if (ap && game.user?.isGM)
            column.append(icon("view", "fa-eye", "Open NET view"));
        if (game.user?.isGM && !isIce(token))
            column.append(icon("configure", "fa-plug", ap ? "Access Point settings" : "Make Access Point"));
    };
    place();
}
export function registerAccessPoints() {
    // DeckKRASH (GM button on the card): the target is jacked out at once – no Superglue check, it is an unsafe Jack Out
    setForceOut(async (token) => {
        const ap = flagOf(token, `${RUN_FLAG}.accessPoint`);
        if (!ap)
            throw Error(`${token.name} has no Access Point to jack out through.`);
        await sendRequest("jack-out", ap, { token: token.id, unsafe: true, reason: "DeckKRASH" });
        ui.notifications.info(`${token.name} was forced out of the NET (DeckKRASH).`);
    });
    // revealing / hiding a floor also reveals / hides the arrows leading into it – with branches the whole way
    // (down arrows + row arrows); an arrow shared by several branches stays visible while one of them is revealed.
    // Works for the window's right-click and Foundry's own tile HUD.
    Hooks.on("updateTile", (tile, changes) => {
        if (typeof changes?.hidden !== "boolean" || !game.user?.isGM || primaryGM()?.id !== game.user?.id)
            return;
        const scene = tile.parent, tree = floorTree(scene), node = tree.get(tile.id);
        if (!node || node.floor.type !== "tile")
            return;
        const floor = node.floor, hidden = changes.hidden;
        const visibleFloor = (n) => n.floor.id === tile.id ? !hidden : !(n.floor.type === "tile" ? scene.tiles.get(n.floor.id)?.hidden : n.floor.hidden);
        const arrows = node.arrows.map(id => scene.tiles.get(id)).filter(Boolean).map((t) => {
            const show = [...tree.values()].some(n => n.arrows.includes(t.id) && visibleFloor(n));
            return { t, hide: !show };
        }).filter(({ t, hide }) => !!t.hidden !== hide).map(({ t, hide }) => ({ _id: t.id, hidden: hide }));
        if (arrows.length)
            void scene.updateEmbeddedDocuments("Tile", arrows);
        // the Black ICE / Demons above this floor follow the floor (revealed with it, hidden with it)
        const ice = iceOfFloor(scene, floor).filter(t => !!t.hidden !== hidden).map(t => ({ _id: t.id, hidden }));
        if (ice.length)
            void scene.updateEmbeddedDocuments("Token", ice);
    });
    // Going Quiet: setting, stealth state from the cards, Evade Detection when a stealthed Netrunner reaches a floor
    game.settings.register(MODULE, "netGoingQuiet", {
        name: "NET: Going Quiet (stealth Netrunning)",
        hint: "Play NET architectures with the stealth rules of the Going Quiet DLC: Jack In normally or quietly (Stealth, 2 NET Actions), Evade Detection instead of Speed checks, Watchers can search, a Control Node breaks stealth.",
        scope: "world", config: true, type: Boolean, default: false, onChange: () => redrawScene(),
    });
    for (const hook of ["createChatMessage", "updateChatMessage"])
        Hooks.on(hook, (message) => { void syncStealth(message).catch(error => console.error(MODULE, "Going Quiet", error)); });
    // GM-Edit: the journal of the "Netrunning" button in the NET view (right-click on it to change; empty = default page)
    game.settings.register(MODULE, "netRulesJournal", {
        scope: "world", config: false, type: String, default: "",
    });
    game.settings.register(MODULE, "netAutoLyingInWait", {
        name: "NET: Black ICE lies in wait automatically",
        hint: "When a Netrunner (not stealthed) enters the floor of Black ICE it has not met yet, a chat card is posted: the GM rolls the Black ICE's SPD, then the Netrunner makes the Speed check.",
        scope: "world", config: true, type: Boolean, default: true,
    });
    // NET Actions counter: show the new value in the Netrunner's window(s)
    Hooks.on("updateToken", (doc, changes) => {
        if (foundry.utils.getProperty(changes ?? {}, `flags.${MODULE}.${ACTIONS_FLAG}`) === undefined && foundry.utils.getProperty(changes ?? {}, `flags.${MODULE}.${PENALTY_FLAG}`) === undefined)
            return;
        for (const view of views.values()) {
            if (view.activeId !== doc.id) continue;
            const box = view.element?.[0]?.querySelector(".cprnet-netview-actions");
            const value = box?.querySelector("[data-net-act-value]");
            if (value) value.innerHTML = netActionsHTML(doc);
            const max = netActionsLimit(doc);
            box?.classList.toggle("is-over", !!max && netActionsOf(doc) > max);
        }
    });
    // a new round: every Netrunner's NET Actions counter goes back to 0, a Vrizzbolt hit lowers the NET Actions of
    // this (the next) turn, Superglue holds one round less (done by one GM)
    Hooks.on("updateCombat", (combat, changes) => {
        if (!("round" in (changes ?? {})) || !game.user?.isGM || primaryGM()?.id !== game.user?.id)
            return;
        for (const scene of netScenes()) {
            const updates = [];
            for (const t of scene.tokens) {
                const u = {}, penalty = netActionsPenaltyOf(t), glue = glueOf(t);
                if (netActionsOf(t) > 0)
                    u[`flags.${MODULE}.${ACTIONS_FLAG}`] = 0;
                if (penalty.active || penalty.pending)
                    u[`flags.${MODULE}.${PENALTY_FLAG}`] = { active: Number(penalty.pending ?? 0) || 0, pending: 0 };
                if (glue)
                    Object.assign(u, glue.rounds > 1 ? { [`flags.${MODULE}.glue.rounds`]: glue.rounds - 1 } : { [`flags.${MODULE}.-=glue`]: null });
                if (Object.keys(u).length)
                    updates.push({ _id: t.id, ...u });
            }
            if (updates.length)
                void scene.updateEmbeddedDocuments("Token", updates).catch((error) => console.error(MODULE, "NET round", error));
        }
    });
    Hooks.on("updateToken", (doc, changes) => {
        if (!("x" in (changes ?? {})) && !("y" in (changes ?? {})))
            return;
        if (!flagOf(doc, RUN_FLAG))
            return;
        const report = (error) => console.error(MODULE, "NET encounter", error);
        if (isStealthed(doc))
            void stealthEncounter(doc).catch(report);
        else
            void ambushEncounter(doc).catch(report);
    });
    Hooks.on("preUpdateToken", rememberStart);
    Hooks.on("preUpdateToken", confirmBlockedMove);
    // tokens placed into a NET scene later start where they were placed
    Hooks.on("createToken", (doc, _options, userId) => {
        if (userId !== game.user?.id || !game.user?.isGM || flagOf(doc, RUN_FLAG) || !isNetScene(doc.parent) || !flagOf(doc.parent, START_FLAG))
            return;
        void doc.parent.update({ [`flags.${MODULE}.${START_FLAG}.${doc.id}`]: { x: doc.x, y: doc.y } }).catch((error) => console.error(MODULE, error));
    });
    Hooks.on("updateActor", (actor) => { if (["blackIce", "demon"].includes(String(actor?.type)))
        redrawScene(); });
    Hooks.on("renderTokenHUD", (hud, html) => decorateHUD(hud, html));
    for (const hook of ["createToken", "updateToken", "deleteToken", "createTile", "updateTile", "deleteTile", "createDrawing", "updateDrawing", "deleteDrawing", "updateRegion", "updateScene"])
        Hooks.on(hook, (doc) => { redrawScene(doc?.parent?.id ?? doc?.id); if (hook === "updateToken")
            refreshAccessPoint(doc); });
    Hooks.on("deleteToken", (doc) => { const view = views.get(doc.id); if (view)
        void view.close();
        // a window whose active token left the architecture: nobody is active any more
        for (const v of views.values())
            if (v.activeId === doc.id) {
                v.activeId = "";
                v.renderFooter();
            } });
    // the Netrunner's own token is highlighted only in its own window – nothing else is drawn twice
    Hooks.once("ready", () => {
        game.socket.on(CHANNEL, (packet) => {
            if (!packet || !("netrun" in packet))
                return;
            if (packet.netrun === "show") {
                if (game.user?.isGM)
                    return;
                const ap = fromUuidSync(packet.accessPoint);
                if (ap)
                    openForMe(ap);
                return;
            }
            if (packet.netrun === "result") {
                const wait = pending.get(packet.id);
                if (!wait || packet.user !== game.user?.id)
                    return;
                clearTimeout(wait.timer);
                pending.delete(packet.id);
                if (packet.error)
                    wait.reject(Error(packet.error));
                else
                    wait.resolve(packet.token);
                return;
            }
            if (primaryGM()?.id !== game.user?.id)
                return;
            const request = packet;
            const run = queue.catch(() => { }).then(() => runRequest(request));
            queue = run;
            const reply = (token, error) => game.socket.emit(CHANNEL, { netrun: "result", id: request.id, user: request.user, gm: game.user.id, token, error });
            void run.then(token => reply(token ?? undefined), error => reply(undefined, error.message ?? String(error)));
        });
    });
}
