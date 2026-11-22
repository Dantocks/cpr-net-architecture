/* Helpers the NET architecture took from Pneuma's Combat Tools – reduced to what Netrunning needs,
 * without libWrapper and without the rest of the Combat Tools. */
export const MODULE = "cpr-net-architecture";

/** the active GM with the lowest id does the work that needs GM rights (socket requests) */
export function primaryGM() {
    return game.users?.filter(user => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id))[0];
}
export const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Cyberpunk RED rolls ----------
/** the system's dice handler (also when the system is loaded from a CDN, e.g. on The Forge) */
export function nativeDiceHandlerURL() {
    const systemPath = "/systems/cyberpunk-red-core/";
    const handlerPath = "modules/extern/cpr-dice-handler.js";
    for (const script of Array.from(globalThis.document?.querySelectorAll?.("script[type='module'][src]") ?? [])) {
        const url = new URL(script.src);
        if (url.pathname.includes(systemPath) && url.pathname.endsWith("/cpr.js"))
            return new URL(handlerPath, url).href;
    }
    for (const entry of globalThis.performance?.getEntriesByType("resource") ?? []) {
        const url = new URL(entry.name);
        if (url.pathname.includes(systemPath) && url.pathname.endsWith("/" + handlerPath))
            return entry.name;
    }
    return systemPath + handlerPath;
}
let api;
const hiddenDice = new WeakSet();
/** the system's Dice class; its 3D dice are skipped for rolls marked hidden (they are shown later with the card) */
async function nativeAPI() {
    api ??= (async () => {
        const Dice = (await import(nativeDiceHandlerURL())).default;
        const original = Dice.handle3dDice;
        if (typeof original === "function" && !original.cprNetArch) {
            const wrapped = function (roll, mode, ...rest) {
                return hiddenDice.has(roll) ? Promise.resolve() : original.call(this, roll, mode, ...rest);
            };
            wrapped.cprNetArch = true;
            Dice.handle3dDice = wrapped;
        }
        return { Dice };
    })();
    return api;
}
/** roll a CPR roll without showing its dice now (only this roll, never the global roll mode) */
export async function rollHidden(roll) {
    await nativeAPI();
    for (const key of ["_roll", "_critRoll"]) {
        let value = roll[key];
        Object.defineProperty(roll, key, {
            configurable: true, enumerable: true,
            get: () => value, set: (next) => { value = next; if (next) hiddenDice.add(next); },
        });
    }
    await roll.roll();
}
export function diceJSON(roll) {
    return [roll._roll, roll._critRoll].filter((die) => !!die).map(die => JSON.stringify(die.toJSON()));
}
/** show dice that were rolled hidden (Dice So Nice: as the user who rolled) */
export async function showSavedDice(dice, mode, userId) {
    const { Dice } = await nativeAPI();
    const user = userId ? game.users?.get(userId) : undefined;
    await Promise.all(dice.map(async (json) => {
        const roll = Roll.fromJSON(json);
        if (user && game.modules?.get("dice-so-nice")?.active && game.dice3d?.showForRoll)
            return game.dice3d.showForRoll(roll, user, true, null, false);
        return Dice.handle3dDice(roll, mode);
    }));
}
/** the system's own roll card for a roll */
const rollIds = new WeakMap();
export async function nativeCard(roll) {
    roll.criticalCard = roll.wasCritical();
    let id = rollIds.get(roll);
    if (!id) { id = foundry.utils.randomID(); rollIds.set(roll, id); }
    return (await renderTemplate(roll.rollCard, roll)).replace(/^(\s*<[\w-]+)/, `$1 data-cprnet-roll-result="${id}"`);
}

// ---------- card look ----------
export function rollOutcomeClass(won) {
    return won === undefined ? "" : won ? "cprnet-roll-winner" : "cprnet-roll-loser";
}
export function attackHeading(title, tag = "h3") {
    return '<' + tag + ' class="cprnet-attack-name" title="' + escapeHTML(title) + '">' + escapeHTML(title) + '</' + tag + '>';
}

// ---------- status effects (e.g. "Unconscious" after Black ICE damage) ----------
export async function applyCombatStatus(actor, id) {
    await actor?.toggleStatusEffect?.(id, { active: true });
}
