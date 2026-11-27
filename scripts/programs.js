// NET Architecture – programs of a Netrunner in the NET (v1.6.0)
//  · right-click menu of a Netrunner token: "Programs" dropdown – every installed program, the rezzed ones on top,
//    a click rezzes / derezzes it (1 NET Action each, with the same limit check as the other NET Actions)
//  · a player rezzing / derezzing on the character sheet while his Netrunner is in the NET: counted the same way
//    (GM changes and module effects – Poison, Shield, Asp, REZ to 0, Undo, Jack In – never count)
//  · hover text of NPC Netrunners in the NET window: their rezzed programs with REZ / DEF
import { MODULE, canSpendNetActions, spendNetActions, netActionsLimit, netActionsOf, combatOf } from "./support.js";
import { installedPrograms, progRez, numberAt } from "./net-actions.js";
const RUN_FLAG = "netrun";
const programDef = (p) => numberAt(p, ["system.def", "system.defense", "system.stats.def"]) ?? 0;
/** installed programs (on the equipped Cyberdeck) – an NPC without "installed" marks: every program it has */
export function programsOf(actor) {
    const installed = installedPrograms(actor);
    if (installed.length)
        return installed;
    return Array.from(actor?.items ?? []).filter(i => String(i.type) === "program");
}
const stats = (p) => { const rez = progRez(p); return `${Number.isFinite(rez) ? `REZ ${rez} · ` : ""}DEF ${programDef(p)}`; };
/** hover text: the rezzed programs */
export function rezzedText(actor) {
    const list = programsOf(actor).filter(p => p.system?.isRezzed);
    return list.length ? `Rezzed: ${list.map(p => `${p.name} (${stats(p)})`).join(", ")}` : "No programs rezzed";
}
/** one entry of the Programs dropdown */
function programEntry(token, p) {
    const on = !!p.system?.isRezzed, rez = progRez(p), dead = !on && Number.isFinite(rez) && rez <= 0;
    return { label: p.name, sub: on ? stats(p) : `${stats(p)} · derezzed`, icon: on ? "fa-toggle-on" : "fa-toggle-off", active: on, disabled: dead, keepOpen: true,
        title: dead ? `${p.name}: REZ 0 – it can't be rezzed` : `${on ? "Derez" : "Rez"} ${p.name} – 1 NET Action`,
        openItem: () => token.actor?.items?.get(p.id)?.sheet?.render(true),
        // the menu stays open: the entry is replaced by its new state
        run: async () => { await toggleProgram(token, p.id); const fresh = token.actor?.items?.get(p.id); return fresh ? programEntry(token, fresh) : undefined; } };
}
/** the menu items: one dropdown "Programs" (rezzed first) */
export function programItems(token) {
    const actor = token?.actor;
    const list = programsOf(actor).sort((a, b) => (Number(!!b.system?.isRezzed) - Number(!!a.system?.isRezzed)) || String(a.name).localeCompare(String(b.name)));
    const summary = () => { const all = programsOf(token?.actor); return `Programs (${all.filter(p => p.system?.isRezzed).length}/${all.length} rezzed)`; };
    const children = list.length ? list.map(p => programEntry(token, p)) : [{ label: "No programs installed", icon: "fa-ban", disabled: true }];
    return [{ dropdown: true, label: summary(), summary, icon: "fa-microchip", children }];
}
/** rez / derez from the menu: 1 NET Action (limit check first) */
export async function toggleProgram(token, id) {
    const program = token?.actor?.items?.get(id);
    if (!program)
        return;
    if (!token.actor.isOwner)
        return void ui.notifications.warn(`You do not own ${token.name}.`);
    const on = !program.system?.isRezzed;
    if (!(await canSpendNetActions(token, 1, `${on ? "Rez" : "Derez"} ${program.name}`)))
        return;
    await program.update({ "system.isRezzed": on }, { cprnetCounted: true });
    await spendNetActions(token, 1);
    ui.notifications.info(`${token.name}: ${program.name} ${on ? "rezzed" : "derezzed"} (1 NET Action).`);
}
/** the NET token an actor runs with right now (jacked in) */
function runningToken(actor) {
    if (!actor)
        return undefined;
    if (actor.isToken)
        return foundry.utils.getProperty(actor.token, `flags.${MODULE}.${RUN_FLAG}`) ? actor.token : undefined;
    for (const scene of game.scenes ?? [])
        for (const t of scene.tokens ?? [])
            if (t.actorLink && t.actorId === actor.id && foundry.utils.getProperty(t, `flags.${MODULE}.${RUN_FLAG}`))
                return t;
    return undefined;
}
export function registerPrograms() {
    // a player rezzes / derezzes on the sheet while his Netrunner is in the NET: 1 NET Action (blocked when none is left)
    Hooks.on("preUpdateItem", (item, changes, options, userId) => {
        if (game.user?.isGM || userId !== game.user?.id || options?.cprnetCounted || options?.cprnetModule || String(item.type) !== "program")
            return;
        const next = foundry.utils.getProperty(changes ?? {}, "system.isRezzed");
        if (next === undefined || !!next === !!item.system?.isRezzed)
            return;
        const token = runningToken(item.parent);
        if (!token)
            return;
        const max = netActionsLimit(token), used = netActionsOf(token);
        if (max && used + 1 > max && combatOf(token)) {
            ui.notifications.warn(`${token.name} has no NET Actions left this round (${used}/${max}) – ${item.name} stays ${item.system?.isRezzed ? "rezzed" : "derezzed"}.`);
            return false;
        }
        void spendNetActions(token, 1);
        ui.notifications.info(`${token.name}: ${item.name} ${next ? "rezzed" : "derezzed"} (1 NET Action).`);
    });
}
