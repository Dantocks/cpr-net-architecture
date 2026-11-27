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
/** With Pneuma's Combat Tools active, their own dice helpers are used (same module instance, so they share its
 *  hidden-dice list and its libWrapper registration) – this module then never touches the dice handler itself,
 *  so libWrapper sees no conflict. */
let ctApi;
async function combatToolsDice() {
    if (!game.modules?.get("pneuma-combattools")?.active) return null;
    ctApi ??= (async () => {
        try {
            const url = foundry.utils.getRoute("modules/pneuma-combattools/scripts/native-combat.js");
            const m = await import(new URL(url, globalThis.location?.href).href);
            return typeof m.rollHidden === "function" && typeof m.showSavedDice === "function" ? m : null;
        } catch (error) {
            console.warn("cpr-net-architecture | Combat Tools dice helpers not available, using own ones", error);
            return null;
        }
    })();
    return ctApi;
}
/** the system's Dice class; its 3D dice are skipped for rolls marked hidden (they are shown later with the card) */
async function nativeAPI() {
    api ??= (async () => {
        const Dice = (await import(nativeDiceHandlerURL())).default;
        if (globalThis.libWrapper?.register) {
            // through libWrapper, so other modules wrapping the dice handler are not overridden
            globalThis.cprNetArchNative = { Dice };
            globalThis.libWrapper.register(MODULE, "cprNetArchNative.Dice.handle3dDice", function (wrapped, roll, mode, ...rest) {
                return hiddenDice.has(roll) ? Promise.resolve() : wrapped(roll, mode, ...rest);
            }, "MIXED");
        } else if (typeof Dice.handle3dDice === "function" && !Dice.handle3dDice.cprNetArch) {
            const original = Dice.handle3dDice;
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
    const ct = await combatToolsDice();
    if (ct) return ct.rollHidden(roll);
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
export async function showSavedDice(dice, mode, userId, audience) {
    // "gmonly": only the GMs see the dice (Going Quiet: hidden GM rolls)
    if (mode === "gmonly") {
        audience = { whisper: Array.from(game.users?.values() ?? []).filter(u => u.isGM).map(u => u.id), blind: false };
        mode = "gmroll";
    }
    const ct = await combatToolsDice();
    if (ct) return ct.showSavedDice(dice, mode, userId, audience);
    const { Dice } = await nativeAPI();
    const user = userId ? game.users?.get(userId) : undefined;
    await Promise.all(dice.map(async (json) => {
        const roll = Roll.fromJSON(json);
        if (user && game.modules?.get("dice-so-nice")?.active && game.dice3d?.showForRoll)
            return game.dice3d.showForRoll(roll, user, true, audience?.whisper ?? null, false);
        if (audience)
            return game.user?.isGM ? Dice.handle3dDice(roll, mode) : undefined;
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

// ---------- NET Actions counter (per Netrunner token in the NET scene) ----------
export const ACTIONS_FLAG = "netActions";
/** the started combat this Netrunner takes part in – its NET token or its body in meat space (the token it jacked in
 *  from) is a combatant. Another combat somewhere else does not count. */
export function combatOf(token) {
    if (!token)
        return undefined;
    const source = foundry.utils.getProperty(token, `flags.${MODULE}.netrun.source`);
    for (const combat of Array.from(game.combats ?? [])) {
        if (!combat.started)
            continue;
        const hit = Array.from(combat.combatants ?? []).some(cb => cb.tokenId === token.id || (source && cb.token?.uuid === source)
            || (token.actorLink && cb.actorId && cb.actorId === token.actorId && cb.token?.actorLink));
        if (hit)
            return combat;
    }
    return undefined;
}
/** option "NET: count only in combat": NET Actions and Sword / Banhammer uses are only counted while the Netrunner is in a
 *  started combat (off: always counted, back to 0 every new round) */
export function countsNow(token) {
    let only = true;
    try {
        only = game.settings.get(MODULE, "netCountOnlyInCombat") !== false;
    }
    catch { /* not registered yet */ }
    return !only || !!combatOf(token);
}
/** NET Actions per Turn by Interface rank (Core p. 199): 1–3 → 2, 4–6 → 3, 7–9 → 4, 10 → 5 (0 = no Interface) */
export function netActionsMax(actor) {
    const roles = actor?.itemTypes?.role ?? [];
    const role = roles.find((r) => r.id === actor?.system?.roleInfo?.activeNetRole) ?? roles.find((r) => /netrunner/i.test(String(r.name)));
    const rank = Number(role?.system?.rank ?? 0) || 0;
    return rank <= 0 ? 0 : rank <= 3 ? 2 : rank <= 6 ? 3 : rank <= 9 ? 4 : 5;
}
/** Vrizzbolt: NET Actions lowered on the Netrunner's next turn – { pending: hit this round, active: this round } */
export const PENALTY_FLAG = "netActionsPenalty";
export const netActionsPenaltyOf = (doc) => foundry.utils.getProperty(doc, `flags.${MODULE}.${PENALTY_FLAG}`) ?? {};
/** NET Actions this Netrunner has this round: by Interface rank, minus an active Vrizzbolt penalty (minimum 2) */
export function netActionsLimit(doc) {
    const base = netActionsMax(doc?.actor);
    const penalty = Number(netActionsPenaltyOf(doc).active ?? 0) || 0;
    return base && penalty ? Math.max(2, base - penalty) : base;
}
export const netActionsOf = (doc) => Math.max(0, Number(foundry.utils.getProperty(doc, `flags.${MODULE}.${ACTIONS_FLAG}`) ?? 0) || 0);
/** before a NET Action: enough left this round? Only while a combat is running (outside one there are no turns).
 *  Player: a message, the action does not happen. GM: the same, with the option to go on anyway. */
export async function canSpendNetActions(runner, cost, label) {
    const max = netActionsLimit(runner), used = netActionsOf(runner);
    if (!max || used + cost <= max || !combatOf(runner))
        return true;
    const text = `${runner.name} has no NET Actions left this round (${used}/${max})${cost > 1 ? ` – ${label} needs ${cost}` : ""}.`;
    if (!game.user?.isGM) {
        ui.notifications.warn(text);
        return false;
    }
    return Dialog.confirm({
        title: "NET Actions used up",
        content: `<p>${foundry.utils.escapeHTML?.(text) ?? text}</p><p>Use <strong>${foundry.utils.escapeHTML?.(label) ?? label}</strong> anyway?</p>`,
        yes: () => true, no: () => false, defaultYes: false,
        options: { classes: ["dialog", "cprnet-netactions-dialog"] },
    });
}
/** after a NET Action: count it on the Netrunner's token */
export async function spendNetActions(runner, cost) {
    if (!runner || !cost || !countsNow(runner)) return;
    try { await runner.update({ [`flags.${MODULE}.${ACTIONS_FLAG}`]: netActionsOf(runner) + cost }); }
    catch (error) { console.warn(MODULE, "NET Actions counter", error); }
}
