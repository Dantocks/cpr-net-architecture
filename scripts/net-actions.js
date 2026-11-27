// GM-Edit: NET Actions and Black ICE / Demon actions from the NET window – one chat card per action,
// built like the module's combat exchange cards (native Cyberpunk RED roll card + Attack / Evasion / Result
// sections + reaction buttons).
//
// Netrunner actions (Backdoor, Eye-Dee, Control, Virus, Pathfinder, Cloak) roll Cyberpunk RED's own Interface
// ability (equipped Cyberdeck + active NET role). DV checks are resolved on the card; an unknown DV is set by
// the GM ("Set DV") and can be remembered on the floor tile.
// Opposed actions (Speed, Slide, Zap) wait for the GM to roll the Black ICE's SPD / PER / DEF on the same card.
// Black ICE / Demons (GM, right-click the Netrunner): ATK (exchange – the Netrunner evades with Speed or not),
// SPD (lying in wait – the Netrunner rolls Speed) and PER (the Netrunner rolls Slide).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { primaryGM, canSpendNetActions, spendNetActions, ACTIONS_FLAG, combatOf, countsNow } from "./support.js";
import { applyRvrPatch, decorateRvr, decorateTick, rvrSummaryEntries, rvrUndo, burnTick, TICK_FLAG, applyUnsafePatch, decorateUnsafe, unsafeSummaryRows } from "./runner-combat.js";
import { diceJSON, nativeCard, nativeDiceHandlerURL, rollHidden, showSavedDice, rollOutcomeClass, attackHeading, applyCombatStatus } from "./support.js";
const MODULE = "cpr-net-architecture";
const CHANNEL = "module.cpr-net-architecture";
const FLOOR_FLAG = "netFloor";
const CARD_FLAG = "netCard";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const FLOOR_KINDS = { password: "Password", file: "File", control: "Control Node", ice: "Black ICE", demon: "Demon", empty: "Empty / other" };
const ICE_NAMES = /\b(asp|giant|hellhound|kraken|liche|raven|sabertooth|scorpion|skunk|wisp|dragon|killer|black\s*ice)\b/i;
const DEMON_NAMES = /\b(demon|imp|efreet|balron)\b/i;
const STAT_LABEL = { atk: "ATK", per: "PER", spd: "SPD", def: "DEF", int: "Interface" };
// ---------- Going Quiet (Tales of the RED DLC): stealth Netrunning ----------
/** world setting: NET architectures are played with the Going Quiet stealth rules */
export const goingQuiet = () => { try {
    return !!game.settings?.get(MODULE, "netGoingQuiet");
}
catch {
    return false;
} };
/** world setting: Going Quiet checks – the GM's rolls and the Watchers' names are kept from the players */
export const quietHidden = () => { try {
    return goingQuiet() && game.settings?.get(MODULE, "netQuietHidden") !== false;
}
catch {
    return false;
} };
/** a Going Quiet card whose GM side is hidden from the players */
const hiddenCard = (s) => !!s && quietHidden() && (s.action === "quietjack" || s.action === "stealth" || (s.type === "ice-vs-runner" && s.action === "int"));
/** world setting: Going Quiet cards (Quiet Jack In, Evade Detection, a Watcher's search) only for the GM and the owners
 *  of the stealthed Netrunner – for everyone else it is an enemy Netrunner sneaking around */
const stealthPrivate = (s) => { try {
    return !!s && goingQuiet() && game.settings?.get(MODULE, "netStealthCardsPrivate") !== false
        && (s.action === "quietjack" || s.action === "stealth" || (s.type === "ice-vs-runner" && s.action === "int"));
}
catch {
    return false;
} };
/** non-GM users who own the Netrunner's actor (kept on the card – the NET token is gone after the Jack Out) */
const ownerIds = (actor) => Array.from(game.users ?? []).filter(u => !u.isGM && actor?.testUserPermission?.(u, "OWNER")).map(u => u.id);
/** may this user see a private stealth card? */
function seesStealthCard(s) {
    if (game.user?.isGM)
        return true;
    const token = game.scenes?.get(s.scene)?.tokens?.get(s.runner?.token ?? "");
    return token ? !!token.isOwner : (s.owners ?? []).includes(game.user?.id);
}
/** the dice of a private stealth card: only the GMs and the Netrunner's owners see them */
function stealthAudience(s) {
    const token = game.scenes?.get(s.scene)?.tokens?.get(s.runner?.token ?? "");
    const owners = token ? ownerIds(token.actor) : (s.owners ?? []);
    return { whisper: [...Array.from(game.users ?? []).filter(u => u.isGM).map(u => u.id), ...owners], blind: false };
}
/** GM-only / player-only parts of a card (removed on the other clients when the card is drawn) */
const gmOnly = (html, tag = "div") => `<${tag} class="cprnet-gm-only">${html}</${tag}>`;
const playerOnly = (html, tag = "div") => `<${tag} class="cprnet-player-only">${html}</${tag}>`;
/** a name the players must not see: the GM gets it, the players a neutral word */
const secretName = (name, neutral) => gmOnly(esc(name), "span") + playerOnly(esc(neutral), "span");
/** the stealth state of a Netrunner token in a NET architecture (only with Going Quiet on) */
export const stealthOf = (token) => goingQuiet() ? (foundry.utils.getProperty(token, `flags.${MODULE}.netrun.stealth`) ?? undefined) : undefined;
export const isStealthed = (token) => stealthOf(token) === "active";
/** Watchers: Demons, enemy Netrunners … – everything with an Interface that is not Black ICE */
const isWatcher = (actor) => isDemon(actor) || (!!actor && String(actor.type) !== "blackIce");
export const NET_ACTIONS = {
    backdoor: { id: "backdoor", label: "Backdoor", icon: "fa-key", ability: "backdoor", dv: true, hint: "Break a Password (Interface + 1d10 vs DV)." },
    eyedee: { id: "eyedee", label: "Eye-Dee", icon: "fa-magnifying-glass", ability: "eyedee", dv: true, hint: "Identify a File (Interface + 1d10 vs DV)." },
    control: { id: "control", label: "Control", icon: "fa-gamepad", ability: "control", dv: true, hint: "Take over a Control Node (Interface + 1d10 vs DV)." },
    virus: { id: "virus", label: "Virus", icon: "fa-virus", ability: "virus", dv: true, hint: "Leave a Virus (Interface + 1d10 vs the architecture's DV)." },
    pathfinder: { id: "pathfinder", label: "Pathfinder", icon: "fa-route", ability: "pathfinder", hint: "Map the architecture (Interface + 1d10)." },
    cloak: { id: "cloak", label: "Cloak", icon: "fa-user-secret", ability: "cloak", hint: "Hide your tracks (Interface + 1d10 – the DV to find you)." },
    speed: { id: "speed", label: "Speed", icon: "fa-person-running", ability: "speed", versus: "spd", hint: "Black ICE lying in wait: Interface + 1d10 (+ Speedy Gonzalvez) vs the Black ICE's SPD + 1d10." },
    slide: { id: "slide", label: "Slide", icon: "fa-person-skiing", ability: "slide", versus: "per", hint: "Get away from Black ICE: Interface + 1d10 vs its PER + 1d10." },
    zap: { id: "zap", label: "Zap", icon: "fa-bolt", ability: "zap", versus: "def", hint: "Attack Black ICE / a Demon: Interface + 1d10 vs its DEF + 1d10 (a Demon defends with its Interface) – 1d6 REZ damage." },
    // a Black ICE lying in wait on a floor the Netrunner enters for the first time: the ICE rolls first, then the Netrunner's Speed check
    ambush: { id: "ambush", label: "Lying in wait", icon: "fa-hourglass-half", ability: "speed", versus: "spd", hint: "Black ICE lying in wait: its SPD + 1d10 first, then the Netrunner's Interface + 1d10 (+ Speedy Gonzalvez) – the Netrunner has to beat it." },
    // Going Quiet
    quietjack: { id: "quietjack", label: "Quiet Jack In", icon: "fa-user-secret", ability: "interface", versus: "int", hint: "Jack In quietly (1 extra NET Action): Interface + 1d10 vs the Interface + 1d10 of every Watcher in the architecture – beat them all to enter undetected." },
    stealth: { id: "stealth", label: "Evade Detection", icon: "fa-user-secret", ability: "cloak", versus: "per", hint: "Stealthed: Interface + Cloak bonus + 1d10 vs a Black ICE's PER + 1d10 (instead of Speed) or a Watcher's Interface + Pathfinder bonus + 1d10 – no NET Action." },
    sword: { id: "sword", label: "Sword attack", icon: "fa-sword", ability: "zap", versus: "def", hint: "Sword: Interface + 1 (Sword, does not stack) + 1d10 vs the target's DEF + 1d10 (a Demon defends with its Interface) – 3d6 REZ to Black ICE and Demons." },
    banhammer: { id: "banhammer", label: "Banhammer attack", icon: "fa-hammer", ability: "zap", versus: "def", hint: "Banhammer: Interface + 1 (Banhammer, does not stack) + 1d10 vs the target's DEF + 1d10 (a Demon defends with its Interface) – 2d6 REZ to Black ICE and Demons (its 3d6 only hit non-Black ICE programs)." },
};
/** what makes sense on the floor the Netrunner stands on (Pathfinder always) */
/** the Netrunner's Sword program (installed / rezzed), if any */
export function swordOf(actor) {
    const programs = (actor?.itemTypes?.program ?? Array.from(actor?.items ?? []).filter((i) => String(i.type) === "program"));
    return programs.find(p => /\bsword\b/i.test(String(p.name)) && (p.system?.isInstalled || p.system?.isRezzed || p.system?.isInstalledInActor));
}
/** the Netrunner's Banhammer program (installed / rezzed), if any */
export function banhammerOf(actor) {
    const programs = (actor?.itemTypes?.program ?? Array.from(actor?.items ?? []).filter((i) => String(i.type) === "program"));
    return programs.find(p => /\bban\s*-?hammer\b/i.test(String(p.name)) && (p.system?.isInstalled || p.system?.isRezzed || p.system?.isInstalledInActor));
}
// ---------- Sword / Banhammer: each installed copy attacks once per round (CP:R p. 200) ----------
/** Attacker programs deactivate right after use, and every copy on the Cyberdeck can be activated once per meatspace
 *  round – so the counter is: installed copies minus the ones used this round (only counted while a combat runs) */
export const ATTACK_USES_FLAG = "attackUses";
const ATTACKER_NAME = { sword: /\bsword\b/i, banhammer: /\bban\s*-?hammer\b/i };
/** the number of installed copies of Sword / Banhammer */
export function attackerCopies(actor, id) {
    const programs = (actor?.itemTypes?.program ?? Array.from(actor?.items ?? []).filter((i) => String(i.type) === "program"));
    return programs.filter(p => ATTACKER_NAME[id]?.test(String(p.name)) && (p.system?.isInstalled || p.system?.isRezzed || p.system?.isInstalledInActor)).length;
}
/** the round a Netrunner's counters belong to (its combat; none: null) */
const roundKey = (token) => { const c = combatOf(token); return c ? `${c.id}:${c.round}` : null; };
const usesOf = (token, id) => Math.max(0, Number(foundry.utils.getProperty(token, `flags.${MODULE}.${ATTACK_USES_FLAG}.${id}`) ?? 0) || 0);
/** copies left this round (counted only in combat – unless the option "count only in combat" is off) */
export function attackerLeft(token, id) {
    const copies = attackerCopies(token?.actor, id);
    // out of combat (option on) nothing is counted – an old count from an earlier fight does not show either
    return { copies, left: countsNow(token) ? Math.max(0, copies - usesOf(token, id)) : copies, blocking: !!combatOf(token) };
}
/** Zap, Sword and Banhammer: attacks on a Black ICE / Demon's REZ */
const rezAttack = (action) => action === "zap" || action === "sword" || action === "banhammer";
export function actionsForKinds(kinds, actor, stealthed = false) {
    const ids = [];
    // Going Quiet: stealthed, the Netrunner evades detection instead of the Speed check
    if (stealthed && (kinds.has("ice") || kinds.has("demon")))
        ids.push("stealth");
    if (kinds.has("password") || kinds.has("file"))
        ids.push("backdoor");
    if (kinds.has("file"))
        ids.push("eyedee");
    if (kinds.has("control"))
        ids.push("control");
    if (kinds.has("ice"))
        ids.push(...(stealthed ? ["slide", "zap"] : ["speed", "slide", "zap"]));
    if (kinds.has("demon") && !ids.includes("zap"))
        ids.push("zap");
    if ((kinds.has("ice") || kinds.has("demon")) && swordOf(actor))
        ids.push("sword");
    if ((kinds.has("ice") || kinds.has("demon")) && banhammerOf(actor))
        ids.push("banhammer");
    ids.push("pathfinder");
    return ids.map(id => NET_ACTIONS[id]);
}
export const RUNNER_ACTIONS = ["pathfinder", "cloak", "virus"].map(id => NET_ACTIONS[id]);
/** Black ICE / Demon actions offered to the GM (right-click the Netrunner) */
export const ICE_ACTIONS = [
    { stat: "atk", label: "ATK – attack", icon: "fa-bolt", demon: true, hint: "Attack the Netrunner (ATK + 1d10, a Demon uses its Interface, vs the Netrunner's Speed evasion)." },
    { stat: "spd", label: "SPD – lying in wait", icon: "fa-hourglass-half", demon: false, hint: "Black ICE lying in wait: SPD + 1d10 vs the Netrunner's Speed check." },
    { stat: "per", label: "PER – vs Slide", icon: "fa-eye", demon: false, hint: "The Netrunner tries to Slide away: PER + 1d10 vs the Netrunner's Slide." },
    // Going Quiet: a Watcher searches for a stealthed Netrunner on its Turn (only shown while the Netrunner is stealthed)
    { stat: "int", label: "INT – search", icon: "fa-magnifying-glass", demon: true, only: "demon", stealth: true, hint: "Going Quiet: on its Turn a Watcher may search once (NET Action): Interface (+ Pathfinder bonus) + 1d10 vs the stealthed Netrunner's Interface + Cloak bonus + 1d10 – if it wins, stealth is broken." },
];
export function floorInfo(tile, iceTokens) {
    const flag = foundry.utils.getProperty(tile, `flags.${MODULE}.${FLOOR_FLAG}`);
    const file = decodeURIComponent(String(tile?.texture?.src ?? "").split(/[?#]/)[0].split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
    // "ControlNodeDV8" → "ControlNodeDV8 Control Node DV 8": both spellings, so camel case and glued numbers are found too
    const split = file.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2");
    const name = `${file} ${split}`.replace(/[_\-.]+/g, " ");
    const kinds = new Set();
    if (flag?.type)
        kinds.add(flag.type);
    else {
        if (/pass\s*word|passwort/i.test(name))
            kinds.add("password");
        if (/\bfiles?\b|datei/i.test(name))
            kinds.add("file");
        if (/control\s*node|controlnode|\bcontrol\b|kontroll/i.test(name))
            kinds.add("control");
        if (ICE_NAMES.test(name))
            kinds.add("ice");
        if (DEMON_NAMES.test(name))
            kinds.add("demon");
    }
    if (iceTokens.some(t => String(t.actor?.type) === "blackIce"))
        kinds.add("ice");
    if (iceTokens.some(t => String(t.actor?.type) === "demon"))
        kinds.add("demon");
    const fromName = name.match(/\bdv\s*(\d{1,2})(?!\d)/i);
    const dv = flag?.dv !== undefined && flag?.dv !== null ? Number(flag.dv) : fromName ? Number(fromName[1]) : null;
    return { kinds, dv: Number.isFinite(dv) ? dv : null };
}
export async function configureFloor(tile) {
    if (!game.user?.isGM)
        return;
    const info = floorInfo(tile, []);
    const current = foundry.utils.getProperty(tile, `flags.${MODULE}.${FLOOR_FLAG}.type`) ?? "";
    const options = [`<option value="">Automatic (${esc([...info.kinds].map(k => FLOOR_KINDS[k]).join(", ") || "not recognised")})</option>`,
        ...Object.entries(FLOOR_KINDS).map(([k, label]) => `<option value="${k}" ${k === current ? "selected" : ""}>${label}</option>`)].join("");
    new Dialog({
        title: "NET floor", default: "save",
        content: `<form><div class="form-group"><label>Floor type</label><select name="type">${options}</select></div>
      <div class="form-group"><label>DV</label><input type="number" name="dv" min="0" step="1" value="${info.dv ?? ""}" placeholder="ask when needed"></div>
      <p class="notes">Used by Backdoor, Eye-Dee, Control and Virus. A DV in the tile's file name is read automatically (e.g. "PasswordDV6.webm", "Control_Node_DV8.webm").</p></form>`,
        buttons: {
            save: { icon: '<i class="fas fa-check"></i>', label: "Save", callback: async (html) => {
                    const form = html[0], raw = form.querySelector("[name=dv]").value.trim();
                    await tile.update({ [`flags.${MODULE}.${FLOOR_FLAG}`]: { type: form.querySelector("[name=type]").value || null, dv: raw === "" ? null : Number(raw) } });
                } },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" },
        },
    }).render(true);
}
// ---------- native Cyberpunk RED rolls ----------
let cpr;
function cprModules() {
    cpr ??= (async () => {
        try {
            const base = nativeDiceHandlerURL().replace(/modules\/extern\/cpr-dice-handler\.js$/, "modules/");
            const [rolls, config] = await Promise.all([import(`${base}rolls/cpr-rolls.js`), import(`${base}system/config.js`)]);
            return { rolls, config: config.default };
        }
        catch (error) {
            console.warn(MODULE, "Cyberpunk RED roll modules not available", error);
            return null;
        }
    })();
    return cpr;
}
const norm = (text) => String(text ?? "").toLowerCase().replace(/[^a-z]/g, "");
function abilityKey(config, wanted) {
    for (const [key, label] of Object.entries(config?.interfaceAbilities ?? {})) {
        const text = norm(game.i18n?.localize(String(label)) ?? String(label));
        if (norm(key) === norm(wanted) || text === norm(wanted) || norm(key).endsWith(norm(wanted)))
            return key;
    }
    return undefined;
}
/** a plain "value + 1d10" native roll card (Black ICE stats, fallback Interface rolls) */
export async function statRoll(title, value, mods = []) {
    const m = await cprModules();
    try {
        if (!m?.rolls?.CPRStatRoll)
            throw Error("no CPRStatRoll");
        const roll = new m.rolls.CPRStatRoll(title, value);
        if (mods.length)
            roll.addMod(mods);
        await rollHidden(roll);
        return { total: Number(roll.resultTotal), html: await nativeCard(roll), dice: diceJSON(roll), roller: game.user.id };
    }
    catch {
        // without the system's roll classes: CPR style d10 (10 explodes once, 1 subtracts)
        const roll = await new Roll("1d10").evaluate();
        let total = value + roll.total + mods.reduce((s, x) => s + x.value, 0), detail = `${roll.total}`;
        if (roll.total === 10 || roll.total === 1) {
            const again = await new Roll("1d10").evaluate();
            total += roll.total === 10 ? again.total : -again.total;
            detail += roll.total === 10 ? ` + ${again.total}` : ` − ${again.total}`;
        }
        const html = `<div class="rollcard"><div class="rollcard-top"><div class="cpr-block"><div class="text-normal">${esc(title)}</div><div class="cprnet-net-total">${total}</div><small>1d10 (${esc(detail)}) + ${value}${mods.map(x => ` ${x.value >= 0 ? "+" : "−"} ${Math.abs(x.value)} ${esc(x.source)}`).join("")}</small></div></div></div>`;
        return { total, html, dice: [JSON.stringify(roll.toJSON())], roller: game.user.id };
    }
}
/** Speedy Gonzalvez: +2 Speed per rezzed copy – house rule: copies stack in the NET rolls of this module
 *  (the character sheet keeps CPR's own total). Without a rez state (older systems): copies installed in the equipped deck. */
function speedyCount(actor) {
    const programs = (actor?.itemTypes?.program ?? Array.from(actor?.items ?? []).filter((i) => String(i.type) === "program"));
    const speedy = programs.filter(p => /speedy\s*gonzalvez/i.test(String(p.name)));
    if (!speedy.length)
        return 0;
    if (speedy.some(p => p.system?.isRezzed !== undefined))
        return speedy.filter(p => p.system?.isRezzed).length;
    const deck = (actor?.itemTypes?.cyberdeck ?? []).find((d) => d.system?.equipped === "equipped");
    const raw = deck?.system?.installedItems;
    const installed = Array.isArray(raw) ? raw : raw?.list ?? deck?.system?.programs?.installed;
    if (!Array.isArray(installed))
        return speedy.length;
    return speedy.filter(p => installed.some((x) => (x?.id ?? x?.uuid ?? x) === p.id || String(x?.uuid ?? x).endsWith(p.id))).length;
}
/** Eraser booster rezzed: +2 to all Cloak Checks */
const eraserRezzed = (actor) => Array.from(actor?.items ?? []).some(i => String(i.type) === "program" && /\beraser\b/i.test(String(i.name)) && i.system?.isRezzed);
function speedBonus(actor) {
    const n = speedyCount(actor);
    return n ? [{ value: 2 * n, source: n > 1 ? `Speedy Gonzalvez ×${n}` : "Speedy Gonzalvez" }] : [];
}
/** what the CPR roll already counts for Speedy Gonzalvez (the system applies one copy itself) */
const speedyInRoll = (roll) => (Array.isArray(roll?.mods) ? roll.mods : []).filter((x) => /speedy|gonzalvez/i.test(String(x?.source ?? x?.name ?? "")))
    .reduce((sum, x) => sum + (Number(x?.value) || 0), 0);
/** Interface ability check of a Netrunner (the system's own roll and dialog) */
export async function runnerRoll(runner, action, extra = []) {
    const actor = runner.actor;
    const deck = (actor?.itemTypes?.cyberdeck ?? []).find((d) => d.system?.equipped === "equipped");
    const netRole = (actor?.itemTypes?.role ?? []).find((r) => r.id === actor.system?.roleInfo?.activeNetRole);
    if (!deck || !netRole) {
        ui.notifications.warn(`${actor?.name ?? "This Netrunner"} needs an equipped Cyberdeck and an active NET role.`);
        return;
    }
    const m = await cprModules();
    const key = m ? abilityKey(m.config, action.ability) : undefined;
    if (m && key) {
        let roll = deck.createRoll(m.rolls.rollTypes.INTERFACEABILITY, actor, { interfaceAbility: key, cyberdeck: deck, netRoleItem: netRole });
        if (!roll)
            return;
        // Netrunner vs Netrunner: the ATK of the attacking program
        if (extra.length)
            roll.addMod(extra);
        // Skunk: Slide −2 per Skunk that hit the Netrunner
        if (action.id === "slide" && skunkPenalty(actor))
            roll.addMod([{ value: skunkPenalty(actor), source: "Skunk" }]);
        // Sword: +1 to the attack (one bonus, however many Swords are installed)
        if (action.id === "sword" && !(Array.isArray(roll.mods) && roll.mods.some((x) => /sword/i.test(String(x?.source ?? "")))))
            roll.addMod([{ value: 1, source: "Sword" }]);
        // Banhammer: +1 to the attack (its ATK, one bonus however many are installed)
        if (action.id === "banhammer" && !(Array.isArray(roll.mods) && roll.mods.some((x) => /banhammer/i.test(String(x?.source ?? "")))))
            roll.addMod([{ value: 1, source: "Banhammer" }]);
        // Speedy Gonzalvez stacks: +2 per rezzed copy, minus what the system's roll already has
        // Going Quiet: + any bonus to Cloak Checks (Eraser +2 while rezzed), unless the system's roll has it already
        if (action.id === "stealth" && eraserRezzed(actor) && !(Array.isArray(roll.mods) && roll.mods.some((x) => /eraser/i.test(String(x?.source ?? x?.name ?? "")))))
            roll.addMod([{ value: 2, source: "Eraser" }]);
        if (action.id === "speed") {
            const n = speedyCount(actor), missing = 2 * n - speedyInRoll(roll);
            if (missing > 0)
                roll.addMod([{ value: missing, source: n > 1 ? `Speedy Gonzalvez ×${n} (stacked)` : "Speedy Gonzalvez" }]);
        }
        if (!await roll.handleRollDialog({ type: "click", ctrlKey: false, metaKey: false }, actor, deck))
            return;
        roll = await deck.confirmRoll(roll);
        if (!roll)
            return;
        await rollHidden(roll);
        if (Number.isInteger(roll.luck) && roll.luck > 0)
            await actor.update({ "system.stats.luck.value": Math.max(0, Number(actor.system.stats.luck.value) - roll.luck) });
        roll.entityData = { actor: actor.id, token: runner.id ?? null, tokens: [], item: deck.id };
        return { total: Number(roll.resultTotal), html: await nativeCard(roll), dice: diceJSON(roll), roller: game.user.id };
    }
    // this system version has no such Interface ability: Interface rank + 1d10
    return statRoll(`${action.label} (Interface)`, Number(netRole.system?.rank ?? 0) || 0, extra.length ? extra : action.id === "speed" ? speedBonus(actor) : action.id === "stealth" && eraserRezzed(actor) ? [{ value: 2, source: "Eraser" }] : action.id === "sword" ? [{ value: 1, source: "Sword" }] : action.id === "banhammer" ? [{ value: 1, source: "Banhammer" }] : action.id === "slide" && skunkPenalty(actor) ? [{ value: skunkPenalty(actor), source: "Skunk" }] : []);
}
// ---------- Black ICE / Demon values ----------
export function numberAt(doc, paths) {
    for (const path of paths) {
        const raw = foundry.utils.getProperty(doc, path);
        const value = typeof raw === "object" && raw !== null ? (raw.value ?? raw.total) : raw;
        const n = Number(value);
        if (value !== undefined && value !== null && value !== "" && Number.isFinite(n))
            return n;
    }
    return null;
}
/** Demons attack (ATK) and defend (vs Zap) with their Interface */
const isDemon = (actor) => String(actor?.type) === "demon";
const usesInterface = (actor, stat) => stat === "int" || (isDemon(actor) && (stat === "atk" || stat === "def"));
/** label of the value an ICE rolls: ATK / PER / SPD / DEF – a Demon's ATK and DEF are its Interface */
const statLabel = (stat, actor) => usesInterface(actor, stat) ? "Interface" : STAT_LABEL[stat];
/** the actor behind a card side (Black ICE / Demon token in the NET scene) */
const sideActor = (s, side) => side ? (game.scenes?.get(s.scene)?.tokens?.get(side.token))?.actor : undefined;
/** a Netrunner's Interface: the rank of the active NET role (otherwise a role named Netrunner) – NPC Netrunners too */
export function netrunnerRank(actor) {
    const roles = actor?.itemTypes?.role ?? Array.from(actor?.items ?? []).filter(i => String(i.type) === "role");
    const role = roles.find(r => r.id === actor?.system?.roleInfo?.activeNetRole) ?? roles.find(r => /netrunner/i.test(String(r.name)));
    const rank = Number(role?.system?.rank);
    return Number.isFinite(rank) && rank > 0 ? rank : null;
}
/** a Netrunner-like actor (enemy / NPC Netrunner): not Black ICE, not a Demon, with an Interface rank */
export const isNetrunnerActor = (actor) => !!actor && String(actor.type) !== "blackIce" && !isDemon(actor) && netrunnerRank(actor) !== null;
/** Going Quiet: "+ any bonus to Pathfinder Checks" of a Watcher – rezzed Pathfinder boosters (See Ya +2, or what the
 *  program states in its modifiers) */
export function pathfinderBonus(actor) {
    const mods = [];
    for (const p of Array.from(actor?.items ?? [])) {
        if (String(p.type) !== "program" || !p.system?.isRezzed)
            continue;
        const own = numberAt(p, ["system.modifiers.pathfinder", "system.modifiers.Pathfinder", "system.bonuses.pathfinder"]);
        const value = own ?? (/\bsee\s*-?\s*ya\b/i.test(String(p.name)) ? 2 : null);
        if (value)
            mods.push({ value, source: p.name });
    }
    return mods;
}
function iceValue(actor, stat) {
    // an enemy (NPC) Netrunner: Interface is the rank of its NET role
    if (stat === "int" && actor && String(actor.type) !== "blackIce" && !isDemon(actor)) {
        const rank = netrunnerRank(actor);
        if (rank !== null)
            return rank;
    }
    const names = usesInterface(actor, stat) ? ["interface"] : [stat, { atk: "attack", per: "perception", spd: "speed", def: "defense" }[stat]];
    return numberAt(actor, names.flatMap(n => [`system.stats.${n}`, `system.${n}`]));
}
/** the Black ICE's description (the text below its stats on the sheet) */
export const iceEffect = (actor) => {
    for (const path of ["system.effect", "system.effect.value", "system.description.value", "system.description", "system.notes"]) {
        const raw = foundry.utils.getProperty(actor, path);
        if (typeof raw !== "string" || !raw.trim())
            continue;
        const text = raw.replace(/<\/(p|div|li)>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
        if (text)
            return text;
    }
    return "";
};
async function askNumber(title, label, value) {
    return new Promise(resolve => new Dialog({
        title, default: "ok", content: `<form><div class="form-group"><label>${esc(label)}</label><input type="number" name="value" value="${value ?? ""}" autofocus></div></form>`,
        buttons: { ok: { icon: '<i class="fas fa-dice-d10"></i>', label: "Roll", callback: (html) => { const raw = html[0].querySelector("[name=value]").value.trim(); resolve(raw === "" ? null : Number(raw)); } },
            cancel: { label: "Cancel", callback: () => resolve(null) } },
        close: () => resolve(null),
    }).render(true));
}
async function iceRoll(ice, stat, edit = false, pathfinder = true) {
    let value = iceValue(ice.actor, stat);
    const label = statLabel(stat, ice.actor);
    if (value === null || edit)
        value = await askNumber(`${ice.name} — ${label}`, label, value);
    if (value === null || !Number.isFinite(value))
        return;
    // Going Quiet: a Watcher's Interface check gets its Pathfinder bonus (vs a stealthed Netrunner, and its search)
    // (not at a Quiet Jack In: that is a plain Interface vs Interface check)
    const mods = stat === "int" && pathfinder ? pathfinderBonus(ice.actor) : [];
    return statRoll(`${ice.name} · ${label}`, value, mods);
}
const isMulti = (s) => s.type === "runner-vs-ice" && !!s.rows;
const sideImg = (token) => String(token?.texture?.src && !String(token.texture.src).includes("*") ? token.texture.src : token?.actor?.img ?? "icons/svg/mystery-man.svg");
export const side = (token) => ({ token: token.id, name: token.name, img: sideImg(token) });
export function section(kind, label, content, classes = "") {
    // Pneuma's pending exchange: centred status, answer buttons in one column below
    if (kind === "pending")
        content = `<div class="rollcard cprnet-pending-exchange">${content}</div>`;
    return `<section class="cprnet-resolution-section cprnet-resolution-${kind}${classes ? " " + classes : ""}" data-cprnet-section="${kind}" aria-label="${esc(label)}">`
        + `<h4 class="cprnet-resolution-label cprnet-resolution-${kind}-label">${esc(label)}</h4><div class="cprnet-resolution-body cprnet-resolution-${kind}-body">${content}</div></section>`;
}
/** the floor tile's type under the action name in the header, e.g. "File" or "Password" */
function floorTypeOf(s) {
    try {
        const scene = game.scenes?.get(s.scene);
        const tile = s.tile ? scene?.tiles?.get(s.tile) : undefined;
        const ice = s.ice ? scene?.tokens?.get(s.ice.token) : undefined;
        const kinds = tile ? floorInfo(tile, ice ? [ice] : []).kinds : new Set();
        if (!kinds.size && ice)
            kinds.add(String(ice.actor?.type) === "demon" ? "demon" : "ice");
        kinds.delete("empty");
        return [...kinds].map(k => FLOOR_KINDS[k]).join(" · ");
    }
    catch {
        return "";
    }
}
function titleOf(s) {
    if (s.type === "ice-vs-runner" && s.action === "int")
        return "Search (Going Quiet)";
    if (s.type === "ice-vs-runner")
        return ICE_ACTIONS.find(a => a.stat === s.action)?.label ?? s.action;
    return NET_ACTIONS[s.action]?.label ?? s.action;
}
/** what the Netrunner answers with, and what the ICE opposes with */
const RESPONSE = { atk: { runner: "speed", ice: "atk" }, spd: { runner: "speed", ice: "spd" }, per: { runner: "slide", ice: "per" }, int: { runner: "stealth", ice: "int" } };
/** Going Quiet rows: Quiet Jack In – every Watcher rolls Interface; Evade Detection – Black ICE PER, Watchers Interface */
const rowStat = (s, row) => s.action === "quietjack" ? "int"
    : s.action === "stealth" ? (isWatcher(sideActor(s, row.ice)) ? "int" : "per") : NET_ACTIONS[s.action].versus;
const stealthCard = (s) => s.action === "quietjack" || s.action === "stealth" || (s.type === "ice-vs-runner" && s.action === "int");
/** what a resolved Going Quiet card means for the Netrunner's stealth */
export function stealthResult(s) {
    const card = s;
    if (!card || card.state !== "resolved" || !stealthCard(card))
        return { unaware: [] };
    if (card.type === "ice-vs-runner")
        return { result: card.outcome === "ice" ? "broken" : "maintained", unaware: [] };
    const rows = card.rows ?? [];
    const free = rows.every(r => r.outcome === "runner");
    const unaware = rows.filter(r => r.outcome === "runner").map(r => r.ice.token);
    if (card.action === "quietjack")
        return { result: free ? "established" : "failed", unaware: [] };
    return { result: free ? "maintained" : "broken", unaware };
}
function cardHTML(s) {
    let body = "";
    if (s.state === "cancelled")
        body = section("pending", "Cancelled", `<p class="cprnet-pending-status">Cancelled by the GM</p>`);
    else if (s.type === "check") {
        const verdict = s.dv === null || s.dv === undefined ? "" : s.outcome === "success" ? "succeeds" : "fails";
        body = section("attack", NET_ACTIONS[s.action]?.label ?? "NET Action", s.runnerRoll?.html ?? "", "cprnet-net-same-title cprnet-attack-result " + rollOutcomeClass(s.outcome === undefined ? undefined : s.outcome === "success"))
            + section("result", "Result", NET_ACTIONS[s.action]?.dv
                ? (s.dv === null || s.dv === undefined
                    ? `<p class="cprnet-combat-outcome"><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(s.runner.name)}: ${s.runnerRoll?.total} · DV unknown</strong></p><div class="cprnet-net-controls cprnet-defense-controls" data-net-gm="dv"></div>`
                    : `<p class="cprnet-combat-outcome"><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(s.runner.name)} <span class="${s.outcome === "success" ? "cprnet-hit" : "cprnet-miss"}">${verdict}</span> vs DV${s.dv}</strong></p>`)
                : `<p class="cprnet-combat-outcome"><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(s.runner.name)}: ${s.runnerRoll?.total}</strong></p><small>${esc(s.floor)}</small>`);
    }
    else if (isMulti(s)) {
        body = multiBody(s);
    }
    else if (s.state === "waiting") {
        const waiting = s.type === "runner-vs-ice" ? "Waiting for the GM: Black ICE roll" : s.action === "atk" ? "Waiting for defense choice" : `Waiting for ${s.runner.name}'s ${NET_ACTIONS[RESPONSE[s.action].runner].label} roll`;
        body = (s.type === "runner-vs-ice" ? section("attack", NET_ACTIONS[s.action].label, s.runnerRoll?.html ?? "", "cprnet-net-same-title cprnet-attack-result") : "")
            + section("pending", s.type === "runner-vs-ice" ? "Opposition" : "Pending attack", `<p class="cprnet-pending-status">${esc(waiting)}</p><div class="cprnet-net-controls cprnet-defense-controls"></div>`);
    }
    else {
        const runnerWins = s.outcome === "runner";
        const runnerSection = s.runnerRoll ? section("evade", s.type === "ice-vs-runner" ? NET_ACTIONS[RESPONSE[s.action].runner].label : NET_ACTIONS[s.action].label, s.runnerRoll.html, (s.type === "runner-vs-ice" ? "cprnet-net-same-title " : "") + "cprnet-defense-result " + rollOutcomeClass(runnerWins))
            : section("evade", "Evasion", `<p class="cprnet-pending-status">${esc(s.runner.name)} does not evade</p>`, "cprnet-defense-result " + rollOutcomeClass(false));
        const iceSection0 = section("attack", s.type === "ice-vs-runner" ? statLabel(s.action, sideActor(s, s.ice)) : `${s.ice?.name} · ${statLabel(NET_ACTIONS[s.action].versus, sideActor(s, s.ice))}`, s.iceRoll?.html ?? "", "cprnet-attack-result " + rollOutcomeClass(!runnerWins));
        // Going Quiet, hidden: the Watcher's search roll only for the GM
        const iceSection = hiddenCard(s) ? gmOnly(iceSection0) : iceSection0;
        let summary = "";
        if (s.type === "ice-vs-runner" && s.action === "int")
            summary = runnerWins ? `${esc(s.runner.name)} <span class="cprnet-hit">stays hidden</span>` : `${hiddenCard(s) ? secretName(s.ice?.name ?? "", "A Watcher") : esc(s.ice?.name)} <span class="cprnet-miss">finds</span> ${esc(s.runner.name)}`;
        else if (s.type === "ice-vs-runner" && s.action === "atk")
            summary = `${esc(s.ice?.name)} <span class="${runnerWins ? "cprnet-miss" : "cprnet-hit"}">${runnerWins ? "misses" : "hits"}</span> ${esc(s.runner.name)}`;
        else if (s.type === "ice-vs-runner" && s.action === "per")
            summary = runnerWins ? `${esc(s.runner.name)} <span class="cprnet-hit">slides away</span> from ${esc(s.ice?.name)}` : `${esc(s.ice?.name)} <span class="cprnet-miss">follows</span> ${esc(s.runner.name)}`;
        else if (s.type === "ice-vs-runner")
            summary = runnerWins ? `${esc(s.runner.name)} <span class="cprnet-miss">gets away</span>` : `${esc(s.ice?.name)} is <span class="cprnet-hit">successful</span>`;
        else if (s.action === "zap")
            summary = `${esc(s.runner.name)} <span class="${runnerWins ? "cprnet-hit" : "cprnet-miss"}">${runnerWins ? "zaps" : "misses"}</span> ${esc(s.ice?.name)}`;
        else if (s.action === "sword")
            summary = `${esc(s.runner.name)}'s Sword <span class="${runnerWins ? "cprnet-hit" : "cprnet-miss"}">${runnerWins ? "hits" : "misses"}</span> ${esc(s.ice?.name)}`;
        else if (s.action === "banhammer")
            summary = `${esc(s.runner.name)}'s Banhammer <span class="${runnerWins ? "cprnet-hit" : "cprnet-miss"}">${runnerWins ? "hits" : "misses"}</span> ${esc(s.ice?.name)}`;
        // Slide (the Netrunner's roll vs the chosen ICE's PER): slides away – or the ICE follows
        else if (s.action === "slide")
            summary = runnerWins ? `${esc(s.runner.name)} <span class="cprnet-hit">slides away</span> from ${esc(s.ice?.name)}` : `${esc(s.ice?.name)} <span class="cprnet-miss">follows</span> ${esc(s.runner.name)}`;
        else
            summary = `${esc(s.runner.name)} <span class="${runnerWins ? "cprnet-hit" : "cprnet-miss"}">${runnerWins ? "succeeds" : "fails"}</span> vs ${esc(s.ice?.name)}`;
        const notes = [];
        // Black ICE successful: its complete description (e.g. "Does 2d6 damage direct to the Netrunner's brain …")
        // a Demon has no Black ICE effect – only its own description, if there is one
        if (s.type === "ice-vs-runner" && s.action === "int")
            notes.push(runnerWins ? "Stealth is maintained." : "Stealth broken: every Watcher in the architecture knows the Netrunner is there – Black ICE reacts as usual.");
        if (iceSuccessful(s)) {
            const demon = isDemon(sideActor(s, s.ice));
            const note = s.effect || (demon ? "" : "Black ICE successful: 1. suffer its Effect · 2. placed on top of the Initiative · 3. it will fight you.");
            if (note)
                notes.push(note);
        }
        else if ((s.type === "ice-vs-runner" && s.action === "spd") || (s.type === "runner-vs-ice" && s.action === "speed"))
            notes.push("Black ICE unsuccessful: go on (Slide away) or fight it.");
        // own section kind: the combat card's damage-roll layout (side label) does not fit this content
        const zap = rezAttack(s.action);
        const applied = appliedHTML(s.applied, zap) + burnHTML(s.burn);
        // one line, the number in red; the font shrinks with the chat width
        const damageLine = s.damage ? `<div class="cprnet-net-dmg"><span>${zap ? "REZ damage" : "Damage"} (${esc(damageFormula(s) ?? s.damage.formula ?? "")})</span><strong>${s.damage.total}</strong></div>` : "";
        const damage = s.damage ? section("netdamage", "Damage", damageLine + applied + `<div class="cprnet-damage-application"><div class="cprnet-net-controls cprnet-damage-controls" data-net-apply></div></div>`) : "";
        body = iceSection + runnerSection + section("result", "Result", `<p class="cprnet-combat-outcome"><span class="cprnet-net-controls" data-net-damage></span><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${summary}</strong></p>`
            + notes.map(n => `<small class="cprnet-net-note">${esc(n)}</small>`).join("")) + damage + programSection(s.prog, s.progApplied, "data-net-prog")
            + (s.type === "ice-vs-runner" && iceSuccessful(s) && isSkunk(sideActor(s, s.ice), s.ice?.name) ? skunkSection(s.skunk, "data-net-skunk") : "");
    }
    if (s.state !== "cancelled" && s.type === "runner-vs-ice" && !isMulti(s))
        body += bystanders(s);
    // like the combat / grenade cards: the action's name sits in the card's header bar (rollcard-top)
    const kind = s.action === "quietjack" || (s.type === "ice-vs-runner" && s.action === "int") ? "Going Quiet" : floorTypeOf(s);
    return `<section class="rollcard cprnet-net-card"><div class="rollcard-top"><div class="cpr-block">${attackHeading(titleOf(s))}${kind ? `<div class="cprnet-net-floor-type">${esc(kind)}</div>` : ""}</div></div><div class="cprnet-resolution-card">${body}</div></section>`;
}
/** Slide / Speed: the other ICE on the floor – Black ICE that follow (Slide), Demons (named only) */
function bystanders(s) {
    const list = (names) => `<ul class="cprnet-macro-list">${names.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
    let html = "";
    if (s.followers?.length)
        html += section("pending", "Follows", list(s.followers) + `<p class="cprnet-pending-status">${s.followers.length > 1 ? "follow" : "follows"} ${esc(s.runner.name)} automatically</p>`);
    if (s.demons?.length)
        html += section("pending", s.demons.length > 1 ? "Demons" : "Demon", list(s.demons)
            + `<p class="cprnet-pending-status">${s.action === "slide" ? "can't slide away from Demons" : "Demons don't lie in wait"}</p>`);
    return html;
}
/** Speed vs every Black ICE on the floor: one row per ICE
 *  (Going Quiet: Quiet Jack In – one row per Watcher; Evade Detection – every Black ICE / Watcher met on the floor) */
function multiBody(s) {
    const action = NET_ACTIONS[s.action];
    const quiet = s.action === "quietjack", stealth = s.action === "stealth";
    const hidden = hiddenCard(s);
    // hidden: a Watcher's name only for the GM (Black ICE met on the floor are seen anyway)
    const rowSecret = (row) => hidden && (quiet || isWatcher(sideActor(s, row.ice)));
    const rowName = (row) => rowSecret(row) ? secretName(row.ice.name, "A Watcher") : esc(row.ice.name);
    const opponents = (rows) => {
        const open = rows.filter(r => !rowSecret(r)).map(r => esc(r.ice.name)), secret = rows.filter(rowSecret);
        const all = rows.map(r => esc(r.ice.name)).join(", ");
        if (!secret.length)
            return all;
        const neutral = [...open, `${secret.length} Watcher${secret.length > 1 ? "s" : ""}`].join(", ");
        return gmOnly(all, "span") + playerOnly(neutral, "span");
    };
    if (s.action === "ambush")
        return ambushBody(s);
    let html = s.runnerRoll ? section("attack", action.label, s.runnerRoll.html, "cprnet-net-same-title cprnet-attack-result")
        // Quiet Jack In without any Watcher: nothing to roll
        : quiet && !s.rows.length ? section("pending", action.label, `<p class="cprnet-pending-status">No Watcher in the architecture – no check needed.</p>`)
            // Going Quiet cards are posted before the Netrunner has rolled
            : section("pending", action.label, `<p class="cprnet-pending-status">${quiet ? "Jacking In quietly" : "Stealthed"}: waiting for ${esc(s.runner.name)}'s ${quiet ? "Interface" : "Interface + Cloak"} check${s.rows.length ? ` vs ${opponents(s.rows)}` : ""}</p><div class="cprnet-net-controls cprnet-defense-controls" data-net-runner-roll></div>`);
    s.rows.forEach((row, i) => {
        if (row.follows) {
            html += section("result", "Result", `<p class="cprnet-combat-outcome"><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(row.ice.name)} <span class="cprnet-miss">follows</span> ${esc(s.runner.name)}</strong></p>`, "cprnet-net-row");
            return;
        }
        if (!row.roll)
            return;
        const runnerWins = row.outcome === "runner";
        const watcher = (quiet || stealth) && isWatcher(sideActor(s, row.ice));
        const summary = s.action === "slide"
            ? (runnerWins ? `${esc(s.runner.name)} <span class="cprnet-hit">slides away</span> from ${esc(row.ice.name)}` : `${esc(row.ice.name)} <span class="cprnet-miss">follows</span> ${esc(s.runner.name)}`)
            : quiet || stealth
                ? (runnerWins ? `${rowName(row)} <span class="cprnet-hit">does not notice</span> ${esc(s.runner.name)}` : `${rowName(row)} <span class="cprnet-miss">detects</span> ${esc(s.runner.name)}`)
                : (runnerWins ? `${esc(row.ice.name)} is <span class="cprnet-hit">unsuccessful</span>` : `${esc(row.ice.name)} is <span class="cprnet-miss">successful</span>`);
        const note = s.action === "speed" ? (runnerWins ? "Black ICE unsuccessful: go on (Slide away) or fight it." : row.effect || "Black ICE successful: 1. suffer its Effect · 2. placed on top of the Initiative · 3. it will fight you.")
            : stealth && !watcher ? (runnerWins ? "Unaware: it does not enter the Initiative Queue – stealth is maintained." : `Stealth broken: ${row.effect || "suffer its Effect"} · it jumps to the top of the Initiative Queue.`)
                : stealth ? (runnerWins ? "Stealth is maintained." : "Stealth broken: every Watcher knows the Netrunner is there.")
                    : "";
        const applied = appliedHTML(row.applied, false) + burnHTML(row.burn);
        const damage = row.damage ? `<div class="cprnet-net-dmg"><span>Damage (${esc(row.damage.formula ?? "")})</span><strong>${row.damage.total}</strong></div>${applied}<div class="cprnet-damage-application"><div class="cprnet-net-controls cprnet-damage-controls" data-net-row-apply="${i}"></div></div>` : "";
        const effects = s.action !== "slide" && !quiet && !watcher; // a failed Slide: the ICE only follows – no program / Skunk effects
        const rollSection = section("attack", `${row.ice.name} · ${statLabel(rowStat(s, row), sideActor(s, row.ice))}`, row.roll.html, "cprnet-attack-result " + rollOutcomeClass(!runnerWins));
        // hidden: the GM's roll (and the Watcher's name in its title) only for the GM
        html += (hidden && (quiet || stealth) ? gmOnly(rollSection) : rollSection)
            + section("result", "Result", `<p class="cprnet-combat-outcome"><span class="cprnet-net-controls" data-net-row-damage="${i}"></span><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${summary}</strong></p>`
                + (note ? `<small class="cprnet-net-note">${esc(note)}</small>` : "") + damage, "cprnet-net-row") + (effects ? programSection(row.prog, row.progApplied, `data-net-row-prog="${i}"`) : "")
            + (effects && row.outcome === "ice" && isSkunk(sideActor(s, row.ice), row.ice.name) ? skunkSection(row.skunk, `data-net-row-skunk="${i}"`) : "");
    });
    const open = s.rows.filter(r => !r.roll && !r.follows);
    if (open.length && s.runnerRoll)
        html += section("pending", "Opposition", `<p class="cprnet-pending-status">Waiting for the GM: ${hidden && (quiet || stealth)
            ? gmOnly(open.map(r => `${esc(r.ice.name)} ${statLabel(rowStat(s, r), sideActor(s, r.ice))}`).join(", "), "span") + playerOnly(`${open.length} hidden check${open.length > 1 ? "s" : ""}`, "span")
            : open.map(r => `${esc(r.ice.name)} ${statLabel(rowStat(s, r), sideActor(s, r.ice))}`).join(", ")}</p><div class="cprnet-net-controls cprnet-defense-controls"></div>`);
    else if (!open.length && (quiet || stealth)) {
        // Going Quiet: what it means for the stealth
        const free = s.rows.every(r => r.outcome === "runner");
        // highlighted: only the key word; what it means for the stealth goes on its own line below
        const [lead, word, sub] = quiet ? (free ? (s.rows.length ? ["enters", "undetected", "Stealth established"] : ["meets", "no Watcher", "Stealth established"]) : ["is", "detected", "No stealth"])
            : free ? ["stays", "hidden", "Stealth maintained"] : ["is", "detected", "Stealth broken"];
        html += section("result", "Stealth", `<p class="cprnet-combat-outcome"><i class="fas fa-user-secret cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(s.runner.name)} ${lead} <span class="${free ? "cprnet-hit" : "cprnet-miss"}">${esc(word)}</span><br><span class="cprnet-net-stealth-sub">${esc(sub)}</span></strong></p>`
            + (quiet && !free ? `<small class="cprnet-net-note">Jack Out and Jack In quietly again to try to establish stealth.</small>` : ""), "cprnet-net-stealth-result");
    }
    else if (!open.length && s.rows.length > 1 && s.action !== "slide") {
        const free = s.rows.every(r => r.outcome === "runner");
        html += section("result", "Result", `<p class="cprnet-combat-outcome"><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(s.runner.name)} is <span class="${free ? "cprnet-hit" : "cprnet-miss"}">${free ? "not caught" : "caught"}</span></strong></p>`);
    }
    if (s.demons?.length || s.followers?.length)
        html += bystanders(s);
    else if (!s.rows.length && !quiet)
        html += section("pending", "Opposition", `<p class="cprnet-pending-status">No Black ICE at this floor.</p>`);
    return html;
}
/** Black ICE lying in wait (first time on its floor): the ICE rolls SPD first, then the Netrunner's Speed check, then one result per ICE */
function ambushBody(s) {
    let html = "";
    for (const row of s.rows)
        if (row.roll)
            html += section("attack", `${row.ice.name} · ${statLabel("spd", sideActor(s, row.ice))}`, row.roll.html, "cprnet-attack-result" + (row.outcome ? " " + rollOutcomeClass(row.outcome === "ice") : ""));
    const open = s.rows.filter(r => !r.roll);
    if (open.length)
        html += section("pending", "Lying in wait", `<p class="cprnet-pending-status">${esc(s.runner.name)} enters ${esc(s.floor)} – Black ICE lies in wait. Waiting for the GM: ${open.map(r => `${esc(r.ice.name)} SPD`).join(", ")}</p><div class="cprnet-net-controls cprnet-defense-controls"></div>`);
    else if (!s.runnerRoll)
        html += section("pending", "Speed check", `<p class="cprnet-pending-status">Waiting for ${esc(s.runner.name)}'s Speed check (Interface + 1d10) – beat ${s.rows.length > 1 ? "every Black ICE" : esc(s.rows[0]?.ice.name ?? "it")}</p><div class="cprnet-net-controls cprnet-defense-controls" data-net-runner-roll></div>`);
    else
        html += section("evade", "Speed", s.runnerRoll.html, "cprnet-defense-result " + rollOutcomeClass(s.rows.every(r => r.outcome === "runner")));
    if (!s.runnerRoll)
        return html;
    s.rows.forEach((row, i) => {
        if (!row.roll || !row.outcome)
            return;
        const runnerWins = row.outcome === "runner";
        const note = runnerWins ? "Black ICE unsuccessful: go on (Slide away) or fight it." : row.effect || "Black ICE successful: 1. suffer its Effect · 2. placed on top of the Initiative · 3. it will fight you.";
        const applied = appliedHTML(row.applied, false) + burnHTML(row.burn);
        const damage = row.damage ? `<div class="cprnet-net-dmg"><span>Damage (${esc(row.damage.formula ?? "")})</span><strong>${row.damage.total}</strong></div>${applied}<div class="cprnet-damage-application"><div class="cprnet-net-controls cprnet-damage-controls" data-net-row-apply="${i}"></div></div>` : "";
        html += section("result", "Result", `<p class="cprnet-combat-outcome"><span class="cprnet-net-controls" data-net-row-damage="${i}"></span><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(row.ice.name)} is <span class="${runnerWins ? "cprnet-hit" : "cprnet-miss"}">${runnerWins ? "unsuccessful" : "successful"}</span></strong></p>`
            + `<small class="cprnet-net-note">${esc(note)}</small>` + damage, "cprnet-net-row") + programSection(row.prog, row.progApplied, `data-net-row-prog="${i}"`)
            + (row.outcome === "ice" && isSkunk(sideActor(s, row.ice), row.ice.name) ? skunkSection(row.skunk, `data-net-row-skunk="${i}"`) : "");
    });
    if (s.rows.length > 1) {
        const free = s.rows.every(r => r.outcome === "runner");
        html += section("result", "Result", `<p class="cprnet-combat-outcome"><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(s.runner.name)} is <span class="${free ? "cprnet-hit" : "cprnet-miss"}">${free ? "not caught" : "caught"}</span></strong></p>`);
    }
    return html;
}
const rowFormula = (s, row) => (s.action === "speed" || s.action === "ambush" || (s.action === "stealth" && !isWatcher(sideActor(s, row.ice)))) && row.outcome === "ice" ? row.effect?.match(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/i)?.[1]?.replace(/\s+/g, "") : undefined;
/** the Black ICE won (ATK hit, SPD / PER successful, the Netrunner's Speed check failed) */
const iceSuccessful = (s) => s.state === "resolved" && s.outcome === "ice"
    && ((s.type === "ice-vs-runner" && s.action !== "int") || (s.type === "runner-vs-ice" && s.action === "speed"));
const damageFormula = (s) => {
    if (s.state !== "resolved")
        return;
    if (s.type === "runner-vs-ice" && s.action === "zap" && s.outcome === "runner")
        return "1d6";
    // Sword: 3d6 REZ to Black ICE and Demons (2d6 only against non-Black ICE programs – no such targets here)
    if (s.type === "runner-vs-ice" && s.action === "sword" && s.outcome === "runner")
        return "3d6";
    // Banhammer: only 2d6 REZ to Black ICE (and Demons) – its 3d6 are for non-Black ICE programs
    if (s.type === "runner-vs-ice" && s.action === "banhammer" && s.outcome === "runner")
        return "2d6";
    // a Demon attacks with Zap: 1d6 (its description may name other dice, e.g. "1d10")
    if (iceSuccessful(s) && s.type === "ice-vs-runner" && isDemon(sideActor(s, s.ice)))
        return "1d6";
    if (iceSuccessful(s))
        return s.effect?.match(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/i)?.[1]?.replace(/\s+/g, "");
    return undefined;
};
function resolve(s) {
    if (s.type === "check") {
        if (NET_ACTIONS[s.action]?.dv && s.dv !== null && s.dv !== undefined && s.runnerRoll)
            s.outcome = s.runnerRoll.total > s.dv ? "success" : "fail";
        s.state = "resolved";
        return;
    }
    if (isMulti(s)) {
        if (s.runnerRoll)
            for (const r of s.rows)
                if (r.roll && !r.outcome && !r.follows)
                    r.outcome = s.runnerRoll.total > r.roll.total ? "runner" : "ice";
        if ((s.runnerRoll || !s.rows.length) && s.rows.every(r => r.roll || r.follows))
            s.state = "resolved";
        return;
    }
    if (!s.iceRoll || (!s.runnerRoll && !s.declined))
        return;
    const runner = s.declined ? -Infinity : s.runnerRoll.total;
    // attacker must beat the defender: ties go to the side that is acting against
    s.outcome = s.type === "ice-vs-runner" ? (s.iceRoll.total > runner ? "ice" : "runner") : (runner > s.iceRoll.total ? "runner" : "ice");
    s.state = "resolved";
}
// ---------- passages: a Password has to be cracked, Black ICE slid past, before going further ----------
const PASS_FLAG = "netPassed";
const passageOf = (tile) => (foundry.utils.getProperty(tile, `flags.${MODULE}.${PASS_FLAG}`) ?? {});
/** password cracked (for everybody) or this Netrunner slid past the Black ICE here */
export function hasPassed(tile, actorId) {
    const p = passageOf(tile);
    return !!p.all || !!(actorId && p.actors?.[actorId]);
}
export const passageOpen = (tile) => !!passageOf(tile).all;
/** current REZ of a Black ICE / Demon (undefined: unknown) */
export function iceRez(actor) {
    const path = actor ? damageTarget(actor, true) : undefined;
    const value = path ? Number(foundry.utils.getProperty(actor, path)) : NaN;
    return Number.isFinite(value) ? value : undefined;
}
/** GM ("Reset Net Arch"): every Black ICE / Demon in the scene back to full REZ – returns how many were healed */
export async function restoreRez(scene) {
    if (!game.user?.isGM || !scene)
        return 0;
    let healed = 0;
    for (const token of Array.from(scene.tokens ?? [])) {
        const actor = token.actor;
        if (!actor || !["blackIce", "demon"].includes(String(actor.type)))
            continue;
        const path = damageTarget(actor, true);
        if (!path?.endsWith(".value"))
            continue;
        const max = Number(foundry.utils.getProperty(actor, path.replace(/\.value$/, ".max")));
        const now = Number(foundry.utils.getProperty(actor, path));
        if (!Number.isFinite(max) || max <= 0 || now === max)
            continue;
        await actor.update({ [path]: max });
        healed++;
    }
    return healed;
}
/** GM: open / close a floor for every Netrunner by hand */
export async function togglePassage(tile) {
    if (!game.user?.isGM)
        return;
    const open = passageOpen(tile);
    await tile.update({ [`flags.${MODULE}.-=${PASS_FLAG}`]: null });
    if (!open)
        await tile.update({ [`flags.${MODULE}.${PASS_FLAG}`]: { all: true } });
}
/** GM: every floor closed again (Reset positions) */
export async function clearPassages(scene) {
    if (!game.user?.isGM || !scene)
        return;
    const updates = Array.from(scene.tiles ?? []).filter(t => foundry.utils.getProperty(t, `flags.${MODULE}.${PASS_FLAG}`))
        .map(t => ({ _id: t.id, [`flags.${MODULE}.-=${PASS_FLAG}`]: null }));
    if (updates.length)
        await scene.updateEmbeddedDocuments("Tile", updates);
}
/** primary GM: a resolved Backdoor / Slide card opens the floor */
async function recordPassage(message) {
    if (primaryGM()?.id !== game.user?.id)
        return;
    const s = foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`);
    if (!s || s.state !== "resolved" || !s.tile)
        return;
    const scene = game.scenes?.get(s.scene), tile = scene?.tiles?.get(s.tile);
    if (!tile)
        return;
    const actorId = scene.tokens?.get(s.runner.token)?.actorId;
    if (s.type === "check" && s.action === "backdoor" && s.outcome === "success") {
        if (!passageOpen(tile))
            await tile.update({ [`flags.${MODULE}.${PASS_FLAG}.all`]: true });
    }
    else if (s.type === "runner-vs-ice" && s.action === "slide" && actorId) {
        const free = isMulti(s) ? s.rows.length > 0 && s.rows.every(r => r.outcome === "runner") : s.outcome === "runner";
        if (free && !hasPassed(tile, actorId))
            await tile.update({ [`flags.${MODULE}.${PASS_FLAG}.actors.${actorId}`]: true });
    }
}
/** only these Black ICE pick one of the Netrunner's programs */
export function progKindOf(actor, name = "") {
    const text = `${actor?.name ?? ""} ${name}`.toLowerCase();
    if (/\basp\b|\braven\b/.test(text))
        return "derez";
    if (/\bdragon\b|\bsabertooth\b|\bsabretooth\b|\bkiller\b/.test(text))
        return "damage";
    return;
}
/** the programs installed on the Netrunner's active cyberdeck – like the "Show Rezzed Programs" macro by
 *  system.isInstalled; narrowed to the equipped deck when its list of installed items can be read */
export function installedPrograms(actor, rezzedOnly = false) {
    const programs = Array.from(actor?.items ?? []).filter(i => String(i.type) === "program" && (i.system?.isInstalled || i.system?.isInstalledInActor));
    const deck = (actor?.itemTypes?.cyberdeck ?? Array.from(actor?.items ?? []).filter((i) => String(i.type) === "cyberdeck")).find((d) => d.system?.equipped === "equipped");
    const raw = deck?.system?.installedItems;
    const list = Array.isArray(raw) ? raw : raw?.list;
    let result = programs;
    if (Array.isArray(list) && list.length) {
        const ids = list.map((x) => String(x?.id ?? x?._id ?? x?.uuid ?? x).split(".").pop());
        const onDeck = programs.filter(p => ids.includes(p.id));
        if (onDeck.length)
            result = onDeck;
    }
    return rezzedOnly ? result.filter(p => p.system?.isRezzed) : result;
}
/** Jack In: every program of the Netrunner starts derezzed (rezzing one costs a NET Action) – a module effect, never
 *  counted; nothing is deleted or uninstalled */
export async function derezAll(actor) {
    const list = Array.from(actor?.items ?? []).filter(i => String(i.type) === "program" && i.system?.isRezzed);
    if (list.length)
        await actor.updateEmbeddedDocuments("Item", list.map(p => ({ _id: p.id, "system.isRezzed": false })), { cprnetModule: true });
    return list.length;
}
export const progRezPath = (program) => typeof program?.system?.rez === "object" && program.system.rez !== null ? "system.rez.value" : "system.rez";
export const progRez = (program) => Number(foundry.utils.getProperty(program, progRezPath(program)));
/** GM, when an exchange resolves: such a Black ICE that hit names a random installed program (main card and Speed rows) */
function pickPrograms(s) {
    const scene = game.scenes?.get(s.scene);
    const actor = scene?.tokens?.get(s.runner.token)?.actor;
    // ASP / Raven derez one of the REZZED programs (like the macro); Dragon / Sabertooth / Killer hit an installed one with REZ > 0
    const random = (kind) => { const list = installedPrograms(actor, kind === "derez").filter(p => kind === "derez" || progRez(p) > 0); const p = list[Math.floor(Math.random() * list.length)]; return p ? { id: p.id, name: p.name } : null; };
    const mainKind = progKindOf(scene?.tokens?.get(s.ice?.token)?.actor, s.ice?.name);
    if (s.type === "ice-vs-runner" && s.state === "resolved" && iceSuccessful(s) && s.prog === undefined && mainKind)
        s.prog = random(mainKind);
    // a failed Slide only means the Black ICE follows – no damage, no program or other effects
    for (const row of s.action === "slide" ? [] : s.rows ?? []) {
        const kind = progKindOf(scene?.tokens?.get(row.ice.token)?.actor, row.ice.name);
        if (row.roll && row.outcome === "ice" && row.prog === undefined && kind)
            row.prog = random(kind);
    }
}
/** the card's "Program" block: which program was hit, what was done to it */
export function programSection(pick, applied, slot) {
    if (pick === undefined)
        return "";
    const line = pick ? `<p class="cprnet-net-applied"><i class="fas fa-microchip"></i> Program hit: <strong>${esc(pick.name)}</strong> <span>(random)</span></p>`
        : `<p class="cprnet-net-applied"><i class="fas fa-microchip"></i> <span>No (rezzed) installed program to hit.</span></p>`;
    const done = !applied ? "" : applied.kind === "derez"
        ? `<p class="cprnet-net-applied"><i class="fas fa-power-off"></i> <strong>${esc(applied.name)}</strong> derezzed</p>`
        : `<p class="cprnet-net-applied"><i class="fas fa-bolt"></i> ${esc(applied.name)}: <strong>−${applied.amount} REZ</strong> <span>(${applied.before} → ${applied.after})</span>${applied.derezzed ? ` – <strong>derezzed</strong>` : ""}</p>`;
    return section("netprogram", "Program", line + done + `<div class="cprnet-damage-application"><div class="cprnet-net-controls cprnet-damage-controls" ${slot}></div></div>`);
}
/** GM controls: Derez (ASP / Raven) or the REZ damage on a random / chosen program (Dragon / Sabertooth / Killer), with Undo */
/** the program chosen in a card's dropdown – kept while the card re-renders (e.g. after the damage roll) */
const progChoice = new Map();
export function programControls(slot, o) {
    if (o.applied) {
        slot.append(button("Undo", "fa-rotate-left", o.undo, true, o.applied.kind === "derez" ? "Rez the program again" : "Give the program its REZ back (and rez it again)", { kind: "reset" }));
        return;
    }
    if (o.kind === "derez") {
        slot.append(button(`Derez ${o.pick.name}`, "fa-power-off", async () => {
            const program = o.runnerActor.items.get(o.pick.id);
            if (!program)
                throw Error(`${o.pick.name} is no longer installed.`);
            const wasRezzed = !!program.system?.isRezzed;
            await program.update({ "system.isRezzed": false });
            await o.set({ id: program.id, name: program.name, kind: "derez", wasRezzed, derezzed: true });
        }, true, "Derez the program", { className: "cprnet-apply-damage" }));
        return;
    }
    // the dropdown is there right away; "Apply" comes with the damage roll
    const select = document.createElement("select");
    select.className = "cprnet-net-select";
    select.title = "Which program takes the damage";
    // only programs that still have REZ left
    select.innerHTML = `<option value="">Random: ${esc(o.pick.name)}</option>` + installedPrograms(o.runnerActor).filter(p => progRez(p) > 0)
        .map(p => `<option value="${p.id}">${esc(p.name)}${Number.isFinite(progRez(p)) ? ` (REZ ${progRez(p)})` : ""}</option>`).join("");
    const kept = progChoice.get(o.choiceKey);
    if (kept && [...select.options].some(x => x.value === kept))
        select.value = kept;
    select.addEventListener("change", () => progChoice.set(o.choiceKey, select.value));
    slot.append(select);
    if (!o.damage)
        return; // roll the damage first
    slot.append(button(`Apply ${o.damage} to the program's REZ`, "fa-microchip", async () => {
        const program = o.runnerActor.items.get(select.value || o.pick.id);
        if (!program)
            throw Error("That program is no longer installed.");
        const before = progRez(program);
        if (!Number.isFinite(before))
            throw Error(`${program.name} has no REZ value.`);
        const after = Math.max(0, before - o.damage), derezzed = after <= 0, wasRezzed = !!program.system?.isRezzed;
        await program.update({ [progRezPath(program)]: after, ...(derezzed ? { "system.isRezzed": false } : {}) });
        await o.set({ id: program.id, name: program.name, kind: "rez", wasRezzed, rezPath: progRezPath(program), before, after, amount: before - after, derezzed });
    }, true, "Subtract the damage from the program's REZ – at 0 it is derezzed", { className: "cprnet-apply-damage" }));
}
// ---------- Skunk: every Slide check of the Netrunner −2 (an active effect, counted by this module's Slide roll) ----------
const SKUNK_FLAG = "skunk";
export const isSkunk = (actor, name = "") => /\bskunk\b/i.test(`${actor?.name ?? ""} ${name}`);
/** −2 per Skunk effect on the actor (one per Skunk that hit) */
function skunkPenalty(actor) {
    const effects = Array.from(actor?.effects ?? []).filter(e => !e.disabled && foundry.utils.getProperty(e, `flags.${MODULE}.${SKUNK_FLAG}`));
    return -2 * new Set(effects.map(e => String(foundry.utils.getProperty(e, `flags.${MODULE}.${SKUNK_FLAG}.ice`) ?? e.id))).size;
}
export function skunkSection(applied, slot) {
    const line = applied ? `<p class="cprnet-net-applied"><i class="fas fa-person-skiing"></i> ${esc(applied.name)}: <strong>Slide −2</strong> <span>(until the Skunk is derezzed)</span></p>` : "";
    return section("netprogram", "Skunk", line + `<div class="cprnet-damage-application"><div class="cprnet-net-controls cprnet-damage-controls" ${slot}></div></div>`);
}
export function skunkControls(slot, o) {
    if (o.applied) {
        slot.append(button("Undo", "fa-rotate-left", o.undo, true, "Remove the Slide −2 effect again", { kind: "reset" }));
        return;
    }
    slot.append(button(`Skunk: Slide −2 on ${o.runner.name}`, "fa-person-skiing", async () => {
        const [effect] = await o.runner.actor.createEmbeddedDocuments("ActiveEffect", [{
                name: "Skunk: Slide −2", img: "icons/svg/downgrade.svg", disabled: false, changes: [],
                description: "Hit by Skunk: every Slide check is lowered by 2 until the Skunk is derezzed.",
                flags: { [MODULE]: { [SKUNK_FLAG]: { ice: o.ice?.token ?? null } } },
            }]);
        if (!effect)
            throw Error("The effect could not be created.");
        await o.set({ name: o.runner.name, effectId: effect.id });
    }, true, "Every Slide check of the Netrunner −2 (an active effect on the character; this module's Slide roll counts it)", { className: "cprnet-apply-damage" }));
}
/** GM: reverses one applied effect of a NET card – the runner's actor may be given when its token is gone (after Jack Out) */
async function undoEffect(message, ref, runnerActor) {
    const s = foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`);
    if (!s || !game.user?.isGM)
        return;
    const scene = game.scenes?.get(s.scene);
    const actor = runnerActor ?? scene?.tokens?.get(s.runner.token)?.actor;
    const target = ref.row === undefined ? s : s.rows?.[ref.row];
    if (!target)
        return;
    if (ref.field === "applied" && target.applied) {
        const a = target.applied;
        if (a.kind === "stats") {
            const changes = {};
            for (const x of a.stats ?? []) {
                const now = Number(foundry.utils.getProperty(actor, `system.stats.${x.stat}.value`));
                changes[`system.stats.${x.stat}.value`] = (Number.isFinite(now) ? now : x.after) + (x.before - x.after);
            }
            if (actor)
                await actor.update(changes);
        }
        else if (ref.row === undefined && rezAttack(s.action)) {
            const ice = scene?.tokens?.get(s.ice?.token)?.actor, path = ice ? damageTarget(ice, true) : undefined;
            if (ice && path)
                await ice.update({ [path]: Number(foundry.utils.getProperty(ice, path)) + a.amount });
        }
        else if (actor)
            await actor.update({ "system.derivedStats.hp.value": Number(foundry.utils.getProperty(actor, "system.derivedStats.hp.value")) + a.amount });
        await send(message, ref.row === undefined ? { applied: null } : { rowApplied: { index: ref.row, applied: null } });
    }
    else if (ref.field === "burn" && target.burn) {
        if (actor)
            await actor.toggleStatusEffect(target.burn.statusId, { active: false });
        await send(message, ref.row === undefined ? { burn: null } : { rowBurn: { index: ref.row, burn: null } });
    }
    else if (ref.field === "skunk" && target.skunk) {
        if (actor?.effects?.get(target.skunk.effectId))
            await actor.deleteEmbeddedDocuments("ActiveEffect", [target.skunk.effectId]);
        await send(message, ref.row === undefined ? { skunk: null } : { rowSkunk: { index: ref.row, skunk: null } });
    }
    else if (ref.field === "prog" && target.progApplied) {
        const p = target.progApplied, program = actor?.items?.get(p.id);
        if (program)
            await program.update({ ...(p.kind === "rez" && p.rezPath ? { [p.rezPath]: p.before } : {}), "system.isRezzed": p.wasRezzed });
        await send(message, ref.row === undefined ? { progApplied: null } : { rowProgApplied: { index: ref.row, progApplied: null } });
    }
}
/** what an applied effect is, in one line (Jack Out summary) */
/** programs the rules destroy – this module only derezzes them (Asp; Dragon / Killer / Sabertooth below 1 REZ; Poison Flatline) */
export const DESTROYED_NOTE = " – by the rules DESTROYED: delete it from the Cyberdeck and buy it again";
export function destroyedByRules(progApplied, iceName = "") {
    if (!progApplied)
        return false;
    if (progApplied.kind === "derez")
        return /\basp\b/i.test(iceName);
    return !!progApplied.derezzed && /\bdragon\b|\bsabre?tooth\b|\bkiller\b/i.test(iceName);
}
function effectLabel(s, ref) {
    const t = ref.row === undefined ? s : s.rows?.[ref.row];
    const ice = ref.row === undefined ? s.ice?.name : s.rows?.[ref.row]?.ice.name;
    if (!t)
        return "";
    if (ref.field === "burn")
        return `${s.runner.name}: On Fire (Mild) – ${ice}`;
    if (ref.field === "skunk")
        return `${s.runner.name}: Slide −2 – ${ice}`;
    if (ref.field === "prog" && t.progApplied)
        return (t.progApplied.kind === "derez" ? `${t.progApplied.name} derezzed – ${ice}` : `${t.progApplied.name}: −${t.progApplied.amount} REZ${t.progApplied.derezzed ? ", derezzed" : ""} – ${ice}`)
            + (destroyedByRules(t.progApplied, ice) ? DESTROYED_NOTE : "");
    const a = t.applied;
    if (a.kind === "stats")
        return `${a.name}: ${(a.stats ?? []).map(x => `${x.stat.toUpperCase()} ${x.before}→${x.after}`).join(", ")} – ${ice}`;
    if (ref.row === undefined && rezAttack(s.action))
        return `${a.name}: −${a.amount} REZ (${NET_ACTIONS[s.action]?.label ?? s.action})`;
    return `${a.name}: −${a.amount} HP – ${ice}`;
}
const stillApplied = (s, ref) => { const t = ref.row === undefined ? s : s.rows?.[ref.row]; return !!t && !!t[ref.field === "prog" ? "progApplied" : ref.field]; };
/** a copy of an applied effect – Redo in the Jack Out summary applies it again after an Undo */
function snapshotOf(s, ref) {
    const t = ref.row === undefined ? s : s.rows?.[ref.row];
    const key = ref.field === "prog" ? "progApplied" : ref.field;
    return t?.[key] ? foundry.utils.deepClone(t[key]) : undefined;
}
/** GM: applies an undone effect again (Redo) from its snapshot */
async function redoEffect(message, ref, data, runnerActor) {
    const s = foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`);
    if (!s || !data || !game.user?.isGM || stillApplied(s, ref))
        return;
    const scene = game.scenes?.get(s.scene);
    const actor = runnerActor ?? scene?.tokens?.get(s.runner.token)?.actor;
    const row = ref.row;
    if (ref.field === "applied") {
        const a = data;
        if (a.kind === "stats") {
            const changes = {}, stats = [];
            for (const x of a.stats ?? []) {
                const before = Number(foundry.utils.getProperty(actor, `system.stats.${x.stat}.value`)), after = Math.max(1, before - (x.before - x.after));
                changes[`system.stats.${x.stat}.value`] = after;
                stats.push({ stat: x.stat, before, after });
            }
            if (actor)
                await actor.update(changes);
            return send(message, row === undefined ? { applied: { ...a, stats } } : { rowApplied: { index: row, applied: { ...a, stats } } });
        }
        if (row === undefined && rezAttack(s.action)) {
            const ice = scene?.tokens?.get(s.ice?.token)?.actor, path = ice ? damageTarget(ice, true) : undefined;
            if (!ice || !path)
                throw Error("The Black ICE is no longer in the scene.");
            const before = Number(foundry.utils.getProperty(ice, path)), after = Math.max(0, before - a.amount);
            await ice.update({ [path]: after });
            return send(message, { applied: { ...a, before, after, amount: before - after } });
        }
        if (!actor)
            throw Error("The Netrunner's actor is not available.");
        const before = Number(foundry.utils.getProperty(actor, "system.derivedStats.hp.value"));
        await actor.update({ "system.derivedStats.hp.value": before - a.amount });
        const again = { ...a, before, after: before - a.amount };
        return send(message, row === undefined ? { applied: again } : { rowApplied: { index: row, applied: again } });
    }
    if (ref.field === "burn") {
        if (actor)
            await applyCombatStatus(actor, data.statusId);
        return send(message, row === undefined ? { burn: data } : { rowBurn: { index: row, burn: data } });
    }
    if (ref.field === "skunk") {
        const [effect] = actor ? await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Skunk: Slide −2", img: "icons/svg/downgrade.svg", disabled: false, changes: [],
                description: "Hit by Skunk: every Slide check is lowered by 2 until the Skunk is derezzed.", flags: { [MODULE]: { [SKUNK_FLAG]: { ice: (row === undefined ? s.ice : s.rows?.[row]?.ice)?.token ?? null } } } }]) : [];
        if (!effect)
            throw Error("The effect could not be created.");
        const again = { ...data, effectId: effect.id };
        return send(message, row === undefined ? { skunk: again } : { rowSkunk: { index: row, skunk: again } });
    }
    // program: derez it again / its REZ damage again
    const p = data, program = actor?.items?.get(p.id);
    if (!program)
        throw Error(`${p.name} is no longer installed.`);
    const wasRezzed = !!program.system?.isRezzed;
    let again;
    if (p.kind === "derez") {
        await program.update({ "system.isRezzed": false });
        again = { ...p, wasRezzed };
    }
    else {
        const path = p.rezPath ?? progRezPath(program), before = Number(foundry.utils.getProperty(program, path)), after = Math.max(0, before - (p.amount ?? 0)), derezzed = after <= 0;
        await program.update({ [path]: after, ...(derezzed ? { "system.isRezzed": false } : {}) });
        again = { ...p, wasRezzed, rezPath: path, before, after, amount: before - after, derezzed };
    }
    return send(message, row === undefined ? { progApplied: again } : { rowProgApplied: { index: row, progApplied: again } });
}
const SUMMARY_FLAG = "netSummary";
/** GM, on Jack Out: one chat card with everything of this run that can still be undone */
export async function postJackOutSummary(token, unsafe) {
    if (!game.user?.isGM || !token)
        return;
    const entries = [];
    for (const message of Array.from((game.messages ?? []))) {
        const s = foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`);
        if (!s || s.type === "rvr" || s.runner?.token !== token.id || s.scene !== token.parent?.id)
            continue;
        for (const field of ["applied", "burn", "prog", "skunk"]) {
            // REZ damage the Netrunner did to Black ICE / Demons (Zap, Sword) is not offered – "Reset Net Arch" restores their REZ
            if (field === "applied" && rezAttack(s.action))
                continue;
            if (stillApplied(s, { field }))
                entries.push({ message: message.id, field, label: effectLabel(s, { field }), data: snapshotOf(s, { field }) });
            (s.rows ?? []).forEach((_, row) => { if (stillApplied(s, { field, row }))
                entries.push({ message: message.id, field, row, label: effectLabel(s, { field, row }), data: snapshotOf(s, { field, row }) }); });
        }
    }
    // what other Netrunners did to this one (Netrunner vs Netrunner)
    entries.push(...rvrSummaryEntries(token));
    const actorUuid = token.actorLink ? token.actor?.uuid : game.actors?.get(token.actorId)?.uuid ?? token.actor?.uuid;
    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token, actor: token.actor }),
        content: summaryHTML(token.name, entries.length + (unsafe ? 1 : 0)),
        flags: { [MODULE]: { [SUMMARY_FLAG]: { runner: token.name, actor: actorUuid, entries, unsafe: unsafe ?? null } } },
    });
}
function summaryHTML(name, count) {
    const head = `<div class="rollcard-top"><div class="cpr-block">${attackHeading("Jack Out")}<div class="cprnet-net-floor-type">${esc(name)}</div></div></div>`;
    return `<section class="rollcard cprnet-net-card cprnet-net-summary">${head}${section("pending", "Undo", count
        ? `<p class="cprnet-pending-status">Effects of this run that can be undone:</p><div class="cprnet-net-summary-list" data-net-summary></div>`
        : `<p class="cprnet-pending-status">Nothing to undo from this run.</p>`)}</section>`;
}
export function summaryOf(message) {
    return foundry.utils.getProperty(message, `flags.${MODULE}.${SUMMARY_FLAG}`);
}
/** fills the Jack Out summary with the current state of every entry (Undo buttons for the GM) */
function decorateSummary(message, root) {
    const data = foundry.utils.getProperty(message, `flags.${MODULE}.${SUMMARY_FLAG}`);
    const list = root.querySelector("[data-net-summary]");
    if (!data || !list)
        return;
    root.classList.add("cprnet-combat-message", "cprnet-net-message");
    const render = () => {
        list.innerHTML = "";
        // Unsafe Jack Out: what the Black ICE did is read live from its card (applied after this summary was posted)
        if (data.unsafe)
            unsafeSummaryRows(list, data, render);
        for (const entry of data.entries) {
            const card = game.messages?.get(entry.message);
            const s = card ? foundry.utils.getProperty(card, `flags.${MODULE}.${CARD_FLAG}`) : undefined;
            if (s && entry.field === "applied" && entry.row === undefined && rezAttack(s.action))
                continue; // older summaries: no REZ damage on ICE
            const row = document.createElement("div");
            row.className = "cprnet-net-summary-row";
            if (!s) {
                row.innerHTML = `<span class="cprnet-net-note">(card deleted)</span>`;
                list.append(row);
                continue;
            }
            const live = entry.rvr ? !!s[entry.field] : stillApplied(s, entry);
            row.innerHTML = `<span class="cprnet-net-summary-label${live ? "" : " is-undone"}">${esc(entry.label || (live ? effectLabel(s, entry) : "") || "–")}</span>`;
            if (!game.user?.isGM) {
                if (!live)
                    row.insertAdjacentHTML("beforeend", `<small class="cprnet-net-note">undone</small>`);
                list.append(row);
                continue;
            }
            if (live)
                row.append(button("Undo", "fa-rotate-left", async () => {
                    const actor = data.actor ? await fromUuid(data.actor) : undefined;
                    await (entry.rvr ? rvrUndo(card, entry.field, actor) : undoEffect(card, entry, actor));
                    render();
                }, true, "Undo this effect", { kind: "reset" }));
            else if (entry.data && !entry.rvr)
                row.append(button("Redo", "fa-rotate-right", async () => {
                    const actor = data.actor ? await fromUuid(data.actor) : undefined;
                    await redoEffect(card, entry, entry.data, actor);
                    render();
                }, true, "Apply this effect again", { className: "cprnet-apply-damage" }));
            list.append(row);
        }
    };
    render();
}
/** Liche: INT, REF, DEX −damage · Scorpion: MOVE −damage (each minimum 1, for an hour) · Hellhound: brain damage + On Fire (Mild) */
export function specialOf(actor, name = "") {
    const text = `${actor?.name ?? ""} ${name}`.toLowerCase();
    if (/\bliche\b/.test(text))
        return "liche";
    if (/\bscorpion\b/.test(text))
        return "scorpion";
    if (/hell\s*hound/.test(text))
        return "hellhound";
    return;
}
const SPECIAL_STATS = { liche: ["int", "ref", "dex"], scorpion: ["move"] };
export function onFireMildId() {
    const all = (CONFIG.statusEffects ?? []);
    return all.find(e => /on\s*fire\s*\(?\s*mild/i.test(String(e.name ?? e.label ?? "")))?.id
        ?? all.find(e => e.id === "r4mbggwd1jmrvhjt")?.id;
}
/** the "applied" lines under the damage */
export function appliedHTML(a, zap) {
    if (!a)
        return "";
    if (a.kind === "stats")
        return `<p class="cprnet-net-applied"><i class="fas fa-brain"></i> ${esc(a.name)}: <strong>${(a.stats ?? []).map(x => `${esc(x.stat.toUpperCase())} ${x.before} → ${x.after}`).join(" · ")}</strong> <span>(for the next hour, minimum 1)</span></p>`;
    return `<p class="cprnet-net-applied"><i class="fas ${zap ? "fa-bolt" : "fa-brain"}"></i> ${esc(a.name)}: <strong>−${a.amount} ${zap ? "REZ" : "HP"}</strong> <span>(${a.before} → ${a.after}${zap ? "" : ", direct to the brain – armor ignored"})</span></p>`;
}
export const burnHTML = (b) => b ? `<p class="cprnet-net-applied"><i class="fas fa-fire"></i> ${esc(b.name)}: <strong>On Fire (Mild)</strong>${b.ticks ? ` <span>(burned ${b.ticks}× · −${2 * b.ticks} HP)</span>` : ""}</p>` : "";
/** GM buttons under a damage roll: Apply / Undo, by Black ICE (Liche, Scorpion: stats; Hellhound: + On Fire) */
export function applyButtons(slot, o) {
    const actor = o.runner?.actor;
    if (!actor)
        return;
    const stats = o.special === "liche" || o.special === "scorpion" ? SPECIAL_STATS[o.special] : undefined;
    if (stats) {
        const label = stats.map(x => x.toUpperCase()).join(", ");
        if (!o.applied)
            slot.append(button(`Apply −${o.total} to ${o.runner.name}'s ${label}`, o.special === "liche" ? "fa-brain" : "fa-person-walking", async () => {
                const changes = {}, list = [];
                for (const stat of stats) {
                    const before = Number(foundry.utils.getProperty(actor, `system.stats.${stat}.value`));
                    if (!Number.isFinite(before))
                        throw Error(`${actor.name} has no ${stat.toUpperCase()} value.`);
                    const after = Math.max(1, before - o.total);
                    changes[`system.stats.${stat}.value`] = after;
                    list.push({ stat, before, after });
                }
                await actor.update(changes);
                await o.setApplied({ name: o.runner.name, amount: o.total, before: 0, after: 0, kind: "stats", stats: list });
            }, true, `Lower ${label} by the damage for the next hour (minimum 1) – no HP damage`, { className: "cprnet-apply-damage" }));
        else
            slot.append(button("Undo", "fa-rotate-left", async () => {
                const changes = {};
                for (const x of o.applied.stats ?? []) {
                    const now = Number(foundry.utils.getProperty(actor, `system.stats.${x.stat}.value`));
                    changes[`system.stats.${x.stat}.value`] = (Number.isFinite(now) ? now : x.after) + (x.before - x.after);
                }
                await actor.update(changes);
                await o.setApplied(null);
            }, true, `Give ${label} back`, { kind: "reset" }));
        return;
    }
    // brain damage (HP) – Hellhound too
    if (!o.applied)
        slot.append(button(`Apply ${o.total} to ${o.runner.name}'s brain`, "fa-brain", async () => {
            const before = Number(foundry.utils.getProperty(actor, "system.derivedStats.hp.value"));
            if (!Number.isFinite(before))
                throw Error(`${actor.name} has no HP value.`);
            await actor.update({ "system.derivedStats.hp.value": before - o.total });
            await o.hp({ name: o.runner.name, amount: o.total, before, after: before - o.total, kind: "hp" });
        }, true, "Direct damage to the Netrunner's HP – armor is ignored", { className: "cprnet-apply-damage" }));
    else
        slot.append(button("Undo", "fa-rotate-left", async () => {
            const now = Number(foundry.utils.getProperty(actor, "system.derivedStats.hp.value"));
            await actor.update({ "system.derivedStats.hp.value": now + o.applied.amount });
            await o.hp(null);
        }, true, "Give the HP back", { kind: "reset" }));
    if (o.special === "hellhound") {
        if (!o.burn)
            slot.append(button(`Set ${o.runner.name} On Fire (Mild)`, "fa-fire", async () => {
                const id = onFireMildId();
                if (!id)
                    throw Error("The status On Fire (Mild) is not available.");
                await applyCombatStatus(actor, id);
                await o.setBurn({ name: o.runner.name, statusId: id });
            }, true, "Hellhound: the Netrunner is set On Fire (Mild)", { className: "cprnet-apply-damage" }));
        else
            // the 2 HP per turn come from the On Fire status itself (Combat Tools) – here only putting it out
            slot.append(button("Put out fire", "fa-fire-extinguisher", async () => {
                await actor.toggleStatusEffect(o.burn.statusId, { active: false });
                await o.setBurn(null);
            }, true, "The fire is out (e.g. a Meat Action) – removes On Fire (Mild)", { kind: "reset" }));
    }
}
async function applyPatch(message, patch, userId) {
    const s = foundry.utils.deepClone(foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`));
    if (s?.type === "rvr")
        return applyRvrPatch(message, s, patch, userId);
    if (s?.type === "unsafe")
        return applyUnsafePatch(message, s, patch, userId);
    if (!s || s.state !== "waiting" && !((patch.damage || "applied" in patch || "burn" in patch || "progApplied" in patch || "skunk" in patch || patch.rowDamage || patch.rowApplied || patch.rowBurn || patch.rowProgApplied || patch.rowSkunk) && s.state === "resolved") && !("dv" in patch))
        return;
    const user = game.users?.get(userId);
    const wasResolved = s.state === "resolved";
    if (patch.cancel) {
        if (!user?.isGM)
            return;
        s.state = "cancelled";
        await refundCancelled(s);
    }
    if (patch.runnerRoll || patch.declined) {
        const runner = game.scenes?.get(s.scene)?.tokens?.get(s.runner.token);
        if (!user?.isGM && !runner?.actor?.testUserPermission(user, "OWNER"))
            return;
        if (s.runnerRoll || s.declined)
            return;
        if (patch.runnerRoll)
            s.runnerRoll = patch.runnerRoll;
        else
            s.declined = true;
    }
    if (patch.iceRoll) {
        if (!user?.isGM)
            return;
        s.iceRoll = patch.iceRoll;
        if (patch.ice) {
            s.ice = patch.ice;
            const iceToken = game.scenes?.get(s.scene)?.tokens?.get(patch.ice.token);
            s.effect = iceEffect(iceToken?.actor) || undefined;
        }
    }
    if (patch.rowRoll && user?.isGM && (s.runnerRoll || s.action === "ambush") && s.rows?.[patch.rowRoll.index] && !s.rows[patch.rowRoll.index].roll) {
        const row = s.rows[patch.rowRoll.index];
        row.roll = patch.rowRoll.roll;
        if (s.runnerRoll)
            row.outcome = s.runnerRoll.total > row.roll.total ? "runner" : "ice"; // the Netrunner has to beat every ICE
        row.effect = iceEffect(game.scenes?.get(s.scene)?.tokens?.get(row.ice.token)?.actor) || undefined;
        // Slide: the Netrunner slides away from this one – every other Black ICE follows
        if (s.action === "slide")
            for (const other of s.rows)
                if (other !== row && !other.roll) {
                    other.follows = true;
                    other.outcome = "ice";
                }
    }
    if (patch.rowDamage && s.rows?.[patch.rowDamage.index])
        s.rows[patch.rowDamage.index].damage = patch.rowDamage.damage;
    if (patch.rowApplied && user?.isGM && s.rows?.[patch.rowApplied.index])
        s.rows[patch.rowApplied.index].applied = patch.rowApplied.applied;
    if (patch.rowBurn && user?.isGM && s.rows?.[patch.rowBurn.index])
        s.rows[patch.rowBurn.index].burn = patch.rowBurn.burn;
    if ("burn" in patch) {
        if (!user?.isGM)
            return;
        s.burn = patch.burn ?? null;
    }
    if ("progApplied" in patch) {
        if (!user?.isGM)
            return;
        s.progApplied = patch.progApplied ?? null;
    }
    if (patch.rowProgApplied && user?.isGM && s.rows?.[patch.rowProgApplied.index])
        s.rows[patch.rowProgApplied.index].progApplied = patch.rowProgApplied.progApplied;
    if ("skunk" in patch) {
        if (!user?.isGM)
            return;
        s.skunk = patch.skunk ?? null;
    }
    if (patch.rowSkunk && user?.isGM && s.rows?.[patch.rowSkunk.index])
        s.rows[patch.rowSkunk.index].skunk = patch.rowSkunk.skunk;
    if ("dv" in patch && user?.isGM)
        s.dv = patch.dv;
    if (patch.damage)
        s.damage = patch.damage;
    if ("applied" in patch) {
        if (!user?.isGM)
            return;
        s.applied = patch.applied ?? null;
    }
    if (!patch.cancel)
        resolve(s);
    pickPrograms(s);
    await message.update({ content: cardHTML(s), [`flags.${MODULE}.${CARD_FLAG}`]: s });
    // Going Quiet, hidden: the GM's rolls (row rolls, the Watcher's search) only for the GM
    const gmMode = hiddenCard(s) ? "gmonly" : "publicroll";
    const dice = [...(patch.rowRoll?.roll.dice ?? []).map(d => [d, patch.rowRoll.roll.roller, gmMode]), ...(patch.rowDamage?.damage.dice ?? []).map(d => [d, patch.rowDamage.damage.roller]),
        ...(patch.runnerRoll?.dice ?? []).map(d => [d, patch.runnerRoll.roller]), ...(patch.iceRoll?.dice ?? []).map(d => [d, patch.iceRoll.roller, gmMode]), ...(patch.damage?.dice ?? []).map(d => [d, patch.damage.roller])];
    // the ICE's hidden attack roll is shown when the exchange resolves
    // (only once – later changes such as Apply / On Fire must not roll them again)
    if (!wasResolved && s.state === "resolved" && s.type === "ice-vs-runner" && s.iceRoll && !patch.iceRoll)
        dice.push(...s.iceRoll.dice.map(d => [d, s.iceRoll.roller, gmMode]));
    // Going Quiet, private stealth card: the other dice only for the GMs and the Netrunner's owners
    const audience = stealthPrivate(s) ? stealthAudience(s) : undefined;
    // CPR's dice handler synchronises Dice So Nice for everybody – one client shows them
    for (const [json, roller, mode] of dice)
        void showSavedDice([json], mode ?? (audience ? "gmroll" : "publicroll"), roller, mode ? undefined : audience).catch(() => { });
}
export async function send(message, patch) {
    if (game.user?.isGM)
        return applyPatch(message, patch, game.user.id);
    if (!primaryGM())
        throw Error("An active GM is needed.");
    game.socket.emit(CHANNEL, { netcard: "patch", message: message.id, patch, user: game.user.id });
}
// ---------- starting actions ----------
/** Netrunner action on its floor (or on itself) */
/** NET Actions the Netrunner chooses (Core p. 197) – counted on the NET Actions counter */
const COSTS_ACTION = new Set(["backdoor", "eyedee", "control", "virus", "pathfinder", "cloak", "slide", "zap", "sword", "banhammer"]);
export async function runNetAction(runner, actionId, floor) {
    const action = NET_ACTIONS[actionId];
    if (!action || !runner?.actor)
        return;
    if (!runner.actor.isOwner)
        return void ui.notifications.warn(`You do not own ${runner.name}.`);
    // every action the Netrunner chooses costs a NET Action (the Speed check against Black ICE is a reaction)
    const cost = COSTS_ACTION.has(action.id) ? 1 : 0;
    // Sword / Banhammer: every installed copy once per round
    const attacker = action.id in ATTACKER_NAME && countsNow(runner) ? action.id : null;
    if (attacker) {
        const { copies, left, blocking } = attackerLeft(runner, attacker);
        if (left <= 0 && blocking) {
            const text = `${runner.name} has used every ${action.label.replace(/ attack$/, "")} this round (${copies} installed) – each copy attacks once per round.`;
            if (!game.user?.isGM)
                return void ui.notifications.warn(text);
            if (!await Dialog.confirm({ title: action.label, content: `<p>${esc(text)}</p><p>Attack anyway?</p>`, defaultYes: false }))
                return;
        }
    }
    if (cost && !(await canSpendNetActions(runner, cost, action.label)))
        return;
    const all = floor.ice ?? [];
    const roll = await runnerRoll(runner, action);
    if (!roll || !Number.isFinite(roll.total))
        return;
    const s = { type: action.versus ? "runner-vs-ice" : "check", action: action.id, scene: runner.parent.id, floor: floor.label, tile: floor.tile?.id,
        runner: side(runner), runnerRoll: roll, state: "waiting",
        // what this card used – given back when the GM cancels it in the same round
        spent: { cost: countsNow(runner) ? cost : 0, attacker, round: roundKey(runner) } };
    // Speed / Slide: every Black ICE on the floor rolls – Demons are only named (no Slide away from a Demon,
    // and only Black ICE lies in wait); Zap: one target, Black ICE or Demon
    // Speed: every Black ICE rolls (one row each); Slide: one row per Black ICE – the GM rolls the PER of the ICE the
    // Netrunner slides away from, the others follow automatically; Zap: one target, Black ICE or Demon
    const rowsAction = action.id === "speed" || action.id === "slide";
    const demons = rowsAction ? all.filter(t => isDemon(t.actor)) : [];
    if (action.versus)
        s.iceOptions = all.filter(t => !demons.includes(t)).map(side);
    if (demons.length)
        s.demons = demons.map(t => t.name);
    if (rowsAction)
        s.rows = (s.iceOptions ?? []).map(ice => ({ ice }));
    if (action.dv)
        s.dv = floor.tile ? floorInfo(floor.tile, []).dv : null;
    if (!action.versus)
        resolve(s);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: runner.actor, token: runner }), content: cardHTML(s), flags: { [MODULE]: { [CARD_FLAG]: s } } });
    await spendNetActions(runner, cost);
    if (attacker)
        await runner.update({ [`flags.${MODULE}.${ATTACK_USES_FLAG}.${attacker}`]: usesOf(runner, attacker) + 1 }).catch(error => console.warn(MODULE, "attack uses", error));
    for (const json of roll.dice)
        void showSavedDice([json], "publicroll", roll.roller).catch(() => { });
}
/** GM, a card is cancelled: its NET Action and its Sword / Banhammer use are given back – only in the same round
 *  (a new round has reset both counters anyway) */
async function refundCancelled(s) {
    const spent = s.spent;
    const token = game.scenes?.get(s.scene)?.tokens?.get(s.runner?.token ?? "");
    if (!spent || spent.refunded || !token || spent.round !== roundKey(token))
        return;
    spent.refunded = true;
    const u = {};
    if (spent.cost)
        u[`flags.${MODULE}.${ACTIONS_FLAG}`] = Math.max(0, (Number(foundry.utils.getProperty(token, `flags.${MODULE}.${ACTIONS_FLAG}`) ?? 0) || 0) - spent.cost);
    if (spent.attacker && usesOf(token, spent.attacker) > 0)
        u[`flags.${MODULE}.${ATTACK_USES_FLAG}.${spent.attacker}`] = usesOf(token, spent.attacker) - 1;
    if (Object.keys(u).length)
        await token.update(u).catch(error => console.warn(MODULE, "refund", error));
}
/** Going Quiet: Quiet Jack In (against every Watcher in the architecture) or Evade Detection (against the Black ICE /
 *  Watchers met on a floor) – posted right away, the Netrunner's player rolls on the card, then the GM rolls each row */
export async function postStealthCard(action, runner, floor, opponents) {
    const s = { type: "runner-vs-ice", action, scene: runner.parent.id, floor: floor.label, tile: floor.tile?.id, runner: side(runner),
        rows: opponents.map(t => ({ ice: side(t) })), state: "waiting", owners: ownerIds(runner.actor) };
    resolve(s); // Quiet Jack In without any Watcher: established right away
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: runner.actor, token: runner }), content: cardHTML(s), flags: { [MODULE]: { [CARD_FLAG]: s } } });
}
/** GM: a Black ICE / Demon acts against the Netrunner on its floor */
export async function startIceAction(ice, runner, stat, floorLabel) {
    if (!game.user?.isGM)
        return;
    const roll = await iceRoll(ice, stat);
    if (!roll)
        return;
    const s = { type: "ice-vs-runner", action: stat, scene: runner.parent.id, floor: floorLabel, runner: side(runner), ice: side(ice), iceRoll: roll, state: "waiting",
        effect: iceEffect(ice.actor) || undefined, owners: ownerIds(runner.actor) };
    // Going Quiet, hidden: the searching Watcher stays anonymous for the players
    const speaker = hiddenCard(s) ? { scene: runner.parent.id, alias: "Watcher" } : ChatMessage.getSpeaker({ actor: ice.actor, token: ice });
    await ChatMessage.create({ speaker, content: cardHTML(s), flags: { [MODULE]: { [CARD_FLAG]: s } } });
    // the ICE's dice are shown when the Netrunner has answered (like the attack roll of an exchange)
    if (stat !== "atk")
        for (const json of roll.dice)
            void showSavedDice([json], hiddenCard(s) ? "gmonly" : stealthPrivate(s) ? "gmroll" : "publicroll", roll.roller, !hiddenCard(s) && stealthPrivate(s) ? stealthAudience(s) : undefined).catch(() => { });
}
/** a card button in Pneuma's chat-button look: chat-buttons.ts styles every [data-net-button]
 *  (GM-only buttons get Pneuma's GM mark, "cancel" a red, "reset" an amber border, icon-only buttons are square) */
export function button(label, icon, run, gm = false, title = "", style = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.netButton = "";
    b.innerHTML = style.iconOnly ? `<i class="fas ${icon}" aria-hidden="true"></i>` : `<i class="fas ${icon}" aria-hidden="true"></i> ${esc(label)}`;
    if (style.className)
        b.className = style.className;
    if (style.kind)
        b.dataset.chatAction = style.kind;
    b.title = title || label;
    b.setAttribute("aria-label", label);
    if (gm)
        b.dataset.gmOnly = "true";
    b.addEventListener("click", async (event) => {
        event.preventDefault();
        b.closest(".cprnet-net-controls")?.querySelectorAll("button").forEach(x => { x.disabled = true; });
        try {
            await run();
        }
        catch (error) {
            ui.notifications.error(error.message ?? String(error));
        }
        finally {
            b.closest(".cprnet-net-controls")?.querySelectorAll("button").forEach(x => { x.disabled = false; });
        }
    });
    return b;
}
/** where the damage goes: Netrunner HP, or the Black ICE's / Demon's current REZ */
export function damageTarget(actor, rez) {
    const paths = rez ? ["system.stats.rez.value", "system.rez.value", "system.stats.rez", "system.rez"] : ["system.derivedStats.hp.value"];
    return paths.find(path => Number.isFinite(Number(foundry.utils.getProperty(actor, path))) && typeof foundry.utils.getProperty(actor, path) !== "object");
}
function decorate(message, root) {
    if (foundry.utils.getProperty(message, `flags.${MODULE}.${SUMMARY_FLAG}`))
        return decorateSummary(message, root);
    if (foundry.utils.getProperty(message, `flags.${MODULE}.${TICK_FLAG}`))
        return decorateTick(message, root);
    const s = foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`);
    if (!s)
        return;
    // Going Quiet: a stealth card of somebody else's Netrunner – not shown at all
    if (stealthPrivate(s) && !seesStealthCard(s)) {
        root.style.display = "none";
        root.classList.add("cprnet-stealth-private");
        return;
    }
    if (s.type === "rvr")
        return decorateRvr(message, root, s);
    if (s.type === "unsafe")
        return decorateUnsafe(message, root, s);
    root.classList.add("cprnet-combat-message", "cprnet-net-message");
    // cards posted by older versions are drawn again from their saved state (header bar, no own portrait column)
    const content = root.querySelector(".message-content");
    if (content && !content.querySelector(":scope > section.rollcard.cprnet-net-card"))
        content.innerHTML = cardHTML(s);
    // Going Quiet, hidden: GM-only parts (Watcher names, the GM's rolls) for the GM, the neutral text for the players
    root.querySelectorAll(game.user?.isGM ? ".cprnet-player-only" : ".cprnet-gm-only").forEach(el => el.remove());
    root.dataset.cprnetExchangeState = s.state === "resolved" ? "resolved" : s.state;
    root.dataset.cprnetOutcome = s.outcome === "success" || s.outcome === "runner" ? "hit" : s.outcome ? "miss" : "none";
    // left column like the combat cards: actor (speaker portrait) ↓ action ↓ target
    const sender = root.querySelector(".message-sender");
    if (sender) {
        const actorSide = s.type === "ice-vs-runner" ? s.ice : s.runner;
        const target = s.type === "ice-vs-runner" ? s.runner : s.ice;
        sender.textContent = s.type === "ice-vs-runner" && hiddenCard(s) && !game.user?.isGM ? "Watcher" : actorSide?.name ?? "";
        sender.parentElement?.querySelector(".cprnet-net-target")?.remove();
        const tile = s.tile ? game.scenes?.get(s.scene)?.tiles?.get(s.tile) : undefined;
        const img = target?.img ?? (tile?.texture?.src ? String(tile.texture.src) : "");
        const info = document.createElement("div");
        info.className = "cprnet-net-target";
        info.innerHTML = `<span class="cprnet-net-arrow">↓</span><span class="cprnet-net-action">${esc(s.type === "ice-vs-runner" ? (s.action === "int" ? "Search" : STAT_LABEL[s.action]) : NET_ACTIONS[s.action]?.label ?? "")}</span>`
            + `<strong>${esc(target?.name ?? s.floor)}</strong>${!img ? "" : /\.(webm|mp4|m4v|ogv|mov)(\?.*)?$/i.test(img)
                // animated tiles: the same video file, muted and looping
                ? `<video src="${esc(img)}" class="${target ? "is-token" : "is-tile"}" autoplay loop muted playsinline></video>`
                : `<img src="${esc(img)}" alt="" class="${target ? "is-token" : "is-tile"}">`}`;
        sender.after(info);
    }
    const gm = !!game.user?.isGM;
    const runner = game.scenes?.get(s.scene)?.tokens?.get(s.runner.token);
    const owner = gm || !!runner?.actor?.isOwner;
    const controls = root.querySelector(".cprnet-net-controls:not([data-net-damage]):not([data-net-apply]):not([data-net-row-damage]):not([data-net-row-apply])");
    if (controls && !controls.childElementCount && s.state !== "cancelled") {
        if (s.type === "check" && controls.dataset.netGm === "dv" && gm)
            controls.append(button("Set DV", "fa-pen", async () => {
                const dv = await askNumber(`${NET_ACTIONS[s.action]?.label} — DV`, `DV of ${s.floor}`, null);
                if (dv === null)
                    return;
                await send(message, { dv });
                if (s.tile) {
                    const tile = game.scenes?.get(s.scene)?.tiles?.get(s.tile);
                    if (tile)
                        await tile.update({ [`flags.${MODULE}.${FLOOR_FLAG}.dv`]: dv });
                }
            }, true, "Set the DV (it is remembered on the floor tile)"));
        // Going Quiet: the card was posted before the Netrunner rolled – the owner rolls first
        const iceFirst = s.action === "ambush" && s.rows.some(r => !r.roll); // lying in wait: the Black ICE rolls first
        if (s.state === "waiting" && isMulti(s) && !s.runnerRoll && !iceFirst) {
            const action = NET_ACTIONS[s.action];
            if (owner)
                controls.append(button(s.action === "quietjack" ? "Interface check" : s.action === "ambush" ? "Speed check" : "Evade Detection", s.action === "ambush" ? "fa-person-running" : action.icon, async () => {
                    if (!runner)
                        throw Error("The Netrunner is no longer in the NET.");
                    const roll = await runnerRoll(runner, s.action === "ambush" ? NET_ACTIONS.speed : action);
                    if (roll)
                        await send(message, { runnerRoll: roll });
                }, false, action.hint));
            if (gm)
                controls.append(button("Cancel", "fa-xmark", () => send(message, { cancel: true }), true, "", { className: "cprnet-cancel-exchange", kind: "cancel" }));
        }
        else if (s.state === "waiting" && isMulti(s) && gm) {
            const scene = game.scenes?.get(s.scene);
            s.rows.forEach((row, index) => {
                if (row.roll || row.follows)
                    return;
                const ice = scene?.tokens?.get(row.ice.token);
                if (!ice)
                    return;
                const stat = rowStat(s, row);
                controls.append(button(`${row.ice.name} ${statLabel(stat, ice.actor)}`, "fa-dice-d10", async () => {
                    const roll = await iceRoll(ice, stat, false, s.action !== "quietjack");
                    if (roll)
                        await send(message, { rowRoll: { index, roll } });
                }, true, `Roll ${row.ice.name}'s ${statLabel(stat, ice.actor)} + 1d10`));
            });
        }
        else if (s.state === "waiting" && s.type === "runner-vs-ice" && gm) {
            const stat = NET_ACTIONS[s.action].versus;
            const scene = game.scenes?.get(s.scene);
            for (const option of s.iceOptions ?? []) {
                const ice = scene?.tokens?.get(option.token);
                if (!ice)
                    continue;
                controls.append(button(`${option.name} ${statLabel(stat, ice.actor)}`, "fa-dice-d10", async () => {
                    const roll = await iceRoll(ice, stat);
                    if (roll)
                        await send(message, { iceRoll: roll, ice: side(ice) });
                }, true, `Roll ${option.name}'s ${statLabel(stat, ice.actor)} + 1d10`));
            }
            if (!s.iceOptions?.length)
                controls.append(document.createTextNode("No Black ICE / Demon at this floor."));
        }
        if (s.state === "waiting" && s.type === "ice-vs-runner") {
            const response = NET_ACTIONS[RESPONSE[s.action].runner];
            if (owner) {
                controls.append(button(s.action === "atk" ? "Evade (Speed)" : response.label, s.action === "atk" ? "fa-person-running" : response.icon, async () => {
                    if (!runner)
                        throw Error("The Netrunner is no longer in the NET.");
                    const roll = await runnerRoll(runner, response);
                    if (roll)
                        await send(message, { runnerRoll: roll });
                }, false, response.hint));
                if (s.action === "atk")
                    controls.append(button("Do not Evade", "fa-arrow-right", () => send(message, { declined: true })));
            }
            if (gm)
                controls.append(button("Cancel exchange", "fa-xmark", () => send(message, { cancel: true }), true, "", { className: "cprnet-cancel-exchange", kind: "cancel" }));
        }
    }
    // GM: apply the ICE's damage directly to the Netrunner's HP (brain damage ignores armor) – and undo it
    const applySlot = root.querySelector("[data-net-apply]");
    const iceToken = s.ice ? game.scenes?.get(s.scene)?.tokens?.get(s.ice.token) : undefined;
    const victim = rezAttack(s.action) ? iceToken : runner;
    const special = !rezAttack(s.action) ? specialOf(iceToken?.actor, s.ice?.name) : undefined;
    const progKind = s.type === "ice-vs-runner" ? progKindOf(iceToken?.actor, s.ice?.name) : undefined;
    const progSlot = root.querySelector("[data-net-prog]");
    if (progSlot && !progSlot.childElementCount && gm && progKind && s.prog && runner?.actor)
        programControls(progSlot, { kind: progKind, pick: s.prog, applied: s.progApplied, damage: s.damage?.total, runnerActor: runner.actor, choiceKey: message.id,
            set: a => send(message, { progApplied: a }), undo: () => undoEffect(message, { field: "prog" }) });
    const skunkSlot = root.querySelector("[data-net-skunk]");
    if (skunkSlot && !skunkSlot.childElementCount && gm && runner?.actor)
        skunkControls(skunkSlot, { applied: s.skunk, runner, ice: s.ice, set: a => send(message, { skunk: a }), undo: () => undoEffect(message, { field: "skunk" }) });
    if (progKind === "damage") { /* the program takes the damage – no brain damage */ }
    else if (applySlot && !applySlot.childElementCount && gm && s.damage && victim?.actor && !rezAttack(s.action))
        applyButtons(applySlot, { special, total: s.damage.total, runner, applied: s.applied, burn: s.burn,
            hp: a => send(message, { applied: a }), setApplied: a => send(message, { applied: a }), setBurn: b => send(message, { burn: b }) });
    else if (applySlot && !applySlot.childElementCount && gm && s.damage && victim?.actor) {
        const target = damageTarget(victim.actor, rezAttack(s.action));
        if (!s.applied)
            applySlot.append(button(rezAttack(s.action) ? `Apply ${s.damage.total} to ${victim.name}'s REZ` : `Apply ${s.damage.total} to ${s.runner.name}'s brain`, rezAttack(s.action) ? "fa-bolt" : "fa-brain", async () => {
                if (!target)
                    throw Error(rezAttack(s.action) ? `${victim.actor.name} has no REZ value.` : `${victim.actor.name} has no HP value.`);
                const before = Number(foundry.utils.getProperty(victim.actor, target)), after = rezAttack(s.action) ? Math.max(0, before - s.damage.total) : before - s.damage.total;
                await victim.actor.update({ [target]: after });
                await send(message, { applied: { name: victim.name, amount: before - after, before, after } });
            }, true, rezAttack(s.action) ? "Subtract the damage from the Black ICE's REZ" : "Direct damage to the Netrunner's HP – armor is ignored", { className: "cprnet-apply-damage" }));
        else
            applySlot.append(button("Undo", "fa-rotate-left", async () => {
                if (!target)
                    return;
                const now = Number(foundry.utils.getProperty(victim.actor, target));
                await victim.actor.update({ [target]: now + s.applied.amount });
                await send(message, { applied: null });
            }, true, rezAttack(s.action) ? "Give the REZ back" : "Give the HP back", { kind: "reset" }));
    }
    // rows (Speed vs several ICE): damage of each successful ICE, applied to the Netrunner's brain
    if (isMulti(s) && gm) {
        s.rows.forEach((row, index) => {
            const slot = root.querySelector(`[data-net-row-damage="${index}"]`), formula = rowFormula(s, row);
            if (slot && !slot.childElementCount && formula && !row.damage)
                slot.append(button("Roll damage", "fa-droplet", async () => {
                    const roll = await new Roll(formula).evaluate();
                    await send(message, { rowDamage: { index, damage: { total: roll.total, formula, html: "", dice: [JSON.stringify(roll.toJSON())], roller: game.user.id } } });
                }, true, `Roll ${row.ice.name}'s damage ${formula}`, { iconOnly: true, className: "cprnet-result-damage" }));
            const rowIce = game.scenes?.get(s.scene)?.tokens?.get(row.ice.token);
            const rowProgKind = progKindOf(rowIce?.actor, row.ice.name);
            const progSlot = root.querySelector(`[data-net-row-prog="${index}"]`);
            if (progSlot && !progSlot.childElementCount && rowProgKind && row.prog && runner?.actor)
                programControls(progSlot, { kind: rowProgKind, pick: row.prog, applied: row.progApplied, damage: row.damage?.total, runnerActor: runner.actor, choiceKey: `${message.id}:${index}`,
                    set: a => send(message, { rowProgApplied: { index, progApplied: a } }), undo: () => undoEffect(message, { field: "prog", row: index }) });
            const skunkSlot = root.querySelector(`[data-net-row-skunk="${index}"]`);
            if (skunkSlot && !skunkSlot.childElementCount && runner?.actor)
                skunkControls(skunkSlot, { applied: row.skunk, runner, ice: row.ice, set: a => send(message, { rowSkunk: { index, skunk: a } }), undo: () => undoEffect(message, { field: "skunk", row: index }) });
            const apply = root.querySelector(`[data-net-row-apply="${index}"]`);
            if (apply && !apply.childElementCount && row.damage && runner?.actor && rowProgKind !== "damage") {
                applyButtons(apply, { special: specialOf(rowIce?.actor, row.ice.name), total: row.damage.total, runner, applied: row.applied, burn: row.burn,
                    hp: a => send(message, { rowApplied: { index, applied: a } }), setApplied: a => send(message, { rowApplied: { index, applied: a } }),
                    setBurn: b => send(message, { rowBurn: { index, burn: b } }) });
            }
        });
    }
    const damageSlot = root.querySelector("[data-net-damage]");
    const formula = damageFormula(s);
    // ICE damage: GM; Zap damage: the Netrunner's player
    if (damageSlot && !damageSlot.childElementCount && formula && !s.damage && (gm || (rezAttack(s.action) && owner)))
        damageSlot.append(button("Roll damage", "fa-droplet", async () => {
            const roll = await new Roll(formula).evaluate();
            const total = roll.total;
            await send(message, { damage: { total, formula, html: "", dice: [JSON.stringify(roll.toJSON())], roller: game.user.id } });
        }, !rezAttack(s.action), `Roll damage ${formula}`, { iconOnly: true, className: "cprnet-result-damage" }));
}
export function registerNetActions() {
    Hooks.on("renderChatMessage", (message, html) => { if (html[0])
        decorate(message, html[0]); });
    for (const hook of ["createChatMessage", "updateChatMessage"])
        Hooks.on(hook, (message) => { void recordPassage(message).catch(error => console.error(MODULE, "NET passage", error)); });
    // Hellbolt: a burning Netrunner ends its Turn – the GM gets a small card (Apply 2 damage / put out)
    Hooks.on("updateCombat", (combat, changes) => { if ("turn" in changes || "round" in changes)
        void burnTick(combat).catch(error => console.error(MODULE, "Hellbolt", error)); });
    Hooks.once("ready", () => {
        game.socket.on(CHANNEL, (packet) => {
            if (!packet?.netcard)
                return;
            if (packet.netcard !== "patch" || primaryGM()?.id !== game.user?.id)
                return;
            const message = game.messages?.get(packet.message);
            if (message)
                void applyPatch(message, packet.patch, packet.user).catch(error => console.error(MODULE, "NET card", error));
        });
    });
}
