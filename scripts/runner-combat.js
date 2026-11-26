// NET Architecture – Netrunner vs Netrunner (Core p. 200–203)
//   Your Interface + Program ATK + 1d10  vs  the target's Interface + 1d10 (or a program's DEF + 1d10)
// Zap (1d6 brain damage / 1d6 REZ), the Anti-Personnel programs (Vrizzbolt, Hellbolt, Nervescrub, Poison Flatline,
// Superglue, DeckKRASH) and attacks on the target's rezzed programs (Zap, Sword, Banhammer).
// The target's rezzed Defenders count by themselves: Flak (ATK of non-Black ICE programs 0), Shield (stops the first
// brain damage, then derezzes itself), Armor (−4 brain damage).
// Every effect is applied only by the GM, with a button on the card – and can be undone there or in the Jack Out
// summary. Programs are never deleted or uninstalled, at most derezzed.
import { canSpendNetActions, spendNetActions, showSavedDice, rollOutcomeClass, attackHeading, applyCombatStatus, primaryGM } from "./support.js";
import { runnerRoll, statRoll, section, button, send, side, installedPrograms, progRez, progRezPath, numberAt, onFireMildId, swordOf, banhammerOf, isStealthed, iceEffect, specialOf, progKindOf, applyButtons, programControls, programSection, skunkControls, skunkSection, isSkunk, damageTarget, appliedHTML, burnHTML, summaryOf, destroyedByRules, DESTROYED_NOTE } from "./net-actions.js";
const MODULE = "cpr-net-architecture";
const CARD_FLAG = "netCard";
const TICK_FLAG = "burnTick";
export const GLUE_FLAG = "glue";
const BURN_FLAG = "burning";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const programs = (actor) => (actor?.itemTypes?.program ?? Array.from(actor?.items ?? []).filter((i) => String(i.type) === "program"));
const ready = (p) => !!(p.system?.isInstalled || p.system?.isRezzed || p.system?.isInstalledInActor);
const find = (actor, rx) => programs(actor).find(p => rx.test(String(p.name)) && ready(p));
const rezzed = (actor, rx) => programs(actor).find(p => rx.test(String(p.name)) && p.system?.isRezzed);
const SHIELD = /\bshield\b/i, ARMOR = /\barmou?r\b/i, FLAK = /\bflak\b/i;
/** the attacks: brain = brain damage (Shield / Armor count), formula = what is rolled after a hit */
export const RVR = {
    zap: { label: "Zap", icon: "fa-bolt", atk: 0, formula: "1d6", brain: true, effect: "1d6 damage direct to the brain." },
    vrizzbolt: { label: "Vrizzbolt", icon: "fa-bolt-lightning", atk: 1, rx: /\bvrizz\s*bolt\b/i, formula: "1d6", brain: true, effect: "1d6 damage direct to the brain · −1 NET Action on the next Turn (minimum 2)." },
    hellbolt: { label: "Hellbolt", icon: "fa-fire", atk: 2, rx: /\bhell\s*bolt\b/i, formula: "2d6", brain: true, effect: "2d6 damage direct to the brain · Cyberdeck and clothing catch fire: 2 damage to HP whenever the Netrunner ends a Turn, until a Meat Action puts it out." },
    nervescrub: { label: "Nervescrub", icon: "fa-brain", atk: 0, rx: /\bnerve\s*scrub\b/i, formula: "1d6", effect: "INT, REF and DEX each lowered by 1d6 for the next hour (minimum 1)." },
    poison: { label: "Poison Flatline", icon: "fa-skull-crossbones", atk: 0, rx: /\bpoison\s*flat\s*line\b/i, effect: "Destroys a random Non-Black ICE program installed on the target's Cyberdeck (this module only derezzes it)." },
    superglue: { label: "Superglue", icon: "fa-hand", atk: 2, rx: /\bsuper\s*glue\b/i, formula: "1d6", effect: "For 1d6 Rounds the target can't go deeper or Jack Out safely (an unsafe Jack Out is still possible)." },
    deckkrash: { label: "DeckKRASH", icon: "fa-explosion", atk: 0, rx: /\bdeck\s*-?\s*[ck]rash\b/i, effect: "The target is forcibly and unsafely Jacked Out – suffering the effect of every rezzed enemy Black ICE met in the architecture." },
    // attacks on a program of the target: DEF + 1d10, damage to its REZ
    pzap: { label: "Zap", icon: "fa-bolt", atk: 0, formula: "1d6", program: true },
    psword: { label: "Sword", icon: "fa-sword", atk: 1, rx: /\bsword\b/i, formula: "2d6", program: true },
    pbanhammer: { label: "Banhammer", icon: "fa-hammer", atk: 1, rx: /\bban\s*-?hammer\b/i, formula: "3d6", program: true },
};
const PERSONNEL = ["zap", "vrizzbolt", "hellbolt", "nervescrub", "poison", "superglue", "deckkrash"];
const programOf = (actor, id) => id === "psword" ? swordOf(actor) : id === "pbanhammer" ? banhammerOf(actor) : RVR[id]?.rx ? find(actor, RVR[id].rx) : undefined;
/** a Black ICE program on a deck (Asp, Hellhound … installed by a Netrunner) */
const isBlackIceProgram = (p) => /black\s*ice/i.test(`${p.system?.class ?? ""} ${p.system?.programClass ?? ""}`);
function interfaceRank(actor) {
    const roles = actor?.itemTypes?.role ?? [];
    const role = roles.find((r) => r.id === actor?.system?.roleInfo?.activeNetRole) ?? roles.find((r) => /netrunner/i.test(String(r.name)));
    return Number(role?.system?.rank ?? 0) || 0;
}
const programDef = (p) => numberAt(p, ["system.def", "system.defense", "system.stats.def"]) ?? 0;
const sceneToken = (s, which) => game.scenes?.get(s.scene)?.tokens?.get(s[which]?.token);
const targetActor = (s) => sceneToken(s, "target")?.actor;
// ---------- menu (NET window: right-click another Netrunner) ----------
/** the items of "Rufus → Kira": Zap, the attacker's Anti-Personnel programs, the target's rezzed programs */
export function runnerAttackItems(runner, target, floorLabel, why = "") {
    const a = runner.actor, t = target.actor, items = [];
    const flak = !!rezzed(t, FLAK);
    items.push({ label: `Attack ${target.name}`, icon: "", section: true });
    for (const id of PERSONNEL) {
        const def = RVR[id];
        const program = id === "zap" ? undefined : programOf(a, id);
        if (id !== "zap" && !program)
            continue;
        const atk = flak && program ? 0 : def.atk;
        items.push({ label: def.label, icon: def.icon, disabled: !!why,
            title: why || `${def.label}: Interface${atk ? ` + ${atk} (ATK)` : ""} + 1d10 vs ${target.name}'s Interface + 1d10${flak && program && def.atk ? " – Flak: ATK 0" : ""} – ${def.effect}`,
            run: () => startRunnerAttack(runner, target, id, undefined, floorLabel) });
    }
    // the target's rezzed programs (Black ICE programs are fought like Black ICE – not here)
    const targets = programs(t).filter(p => p.system?.isRezzed && !isBlackIceProgram(p));
    if (targets.length) {
        items.push({ label: `${target.name}'s rezzed programs`, icon: "", section: true });
        const attacks = ["pzap", "psword", "pbanhammer"]; // always three columns (the menu grid) – missing programs greyed out
        const lacks = (id) => id !== "pzap" && !programOf(a, id) ? `${runner.name} has no ${RVR[id].label} installed` : "";
        items.push({ label: "Program", icon: "", text: true, row: "matrix:head" }, ...attacks.map(id => ({ label: RVR[id].label, icon: "", text: true, row: "matrix:head" })));
        for (const p of targets) {
            const rez = progRez(p);
            items.push({ label: p.name, sub: `${Number.isFinite(rez) ? `REZ ${rez} · ` : ""}DEF ${programDef(p)}`, icon: "", text: true, row: `matrix:prog:${p.id}` });
            for (const id of attacks) {
                const def = RVR[id], atk = flak && id !== "pzap" ? 0 : def.atk;
                items.push({ label: "", icon: def.icon, row: `matrix:prog:${p.id}`, disabled: !!(why || lacks(id)),
                    title: why || lacks(id) || `${def.label} ${p.name}: Interface${atk ? ` + ${atk}` : ""} + 1d10 vs DEF ${programDef(p)} + 1d10 – ${def.formula} REZ`,
                    run: () => startRunnerAttack(runner, target, id, p.id, floorLabel) });
            }
        }
    }
    return items;
}
/** the attacker rolls – the card waits for the target's defense */
export async function startRunnerAttack(runner, target, id, programId, floorLabel) {
    const def = RVR[id];
    if (!def || !runner?.actor || !target?.actor)
        return;
    if (!runner.actor.isOwner)
        return void ui.notifications.warn(`You do not own ${runner.name}.`);
    const program = programId ? target.actor.items.get(programId) : undefined;
    if (def.program && !program)
        return void ui.notifications.warn("That program is no longer rezzed.");
    if (!(await canSpendNetActions(runner, 1, def.program ? `${def.label} ${program.name}` : def.label)))
        return;
    const own = id === "zap" || id === "pzap" ? undefined : programOf(runner.actor, id);
    const flak = !!own && !!rezzed(target.actor, FLAK);
    const atk = flak ? 0 : def.atk;
    const roll = await runnerRoll(runner, { id: "zap", label: def.program ? `${def.label} → ${program.name}` : def.label, ability: "zap", hint: def.effect ?? "" }, atk ? [{ value: atk, source: `${own?.name ?? def.label} ATK` }] : []);
    if (!roll || !Number.isFinite(roll.total))
        return;
    const s = { type: "rvr", action: id, scene: runner.parent.id, floor: floorLabel, runner: side(runner), target: side(target), runnerRoll: roll, state: "waiting",
        atk: def.atk, flak, program: program ? { id: program.id, name: program.name, def: programDef(program) } : undefined };
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: runner.actor, token: runner }), content: rvrCardHTML(s), flags: { [MODULE]: { [CARD_FLAG]: s } } });
    await spendNetActions(runner, 1);
    for (const json of roll.dice)
        void showSavedDice([json], "publicroll", roll.roller).catch(() => { });
}
// ---------- card ----------
const hit = (s) => s.state === "resolved" && s.outcome === "runner";
/** what the target's rezzed Defenders do against this attack (from the card's point of view, live) */
function defenders(s) {
    const t = targetActor(s), def = RVR[s.action];
    if (!t || !def?.brain)
        return {};
    const shield = rezzed(t, SHIELD), armor = rezzed(t, ARMOR);
    return { shield: shield ? { id: shield.id, name: shield.name } : undefined, armor: armor ? { id: armor.id, name: armor.name } : undefined };
}
function appliedLines(s) {
    const lines = [];
    const line = (icon, html) => lines.push(`<p class="cprnet-net-applied"><i class="fas ${icon}"></i> ${html}</p>`);
    const a = s.applied;
    if (a?.shield)
        line("fa-shield-halved", `${esc(a.shield.name)} <strong>stops the brain damage</strong> <span>(Shield derezzed)</span>`);
    else if (a && !a.amount && a.armor)
        line("fa-shield-halved", `${esc(a.armor)} <strong>absorbs the brain damage</strong> <span>(−4)</span>`);
    else if (a)
        line("fa-brain", `${esc(a.name)}: <strong>−${a.amount} HP</strong> <span>(${a.before} → ${a.after}${a.armor ? `, ${esc(a.armor)} −4` : ""}, direct to the brain – armor ignored)</span>`);
    if (s.prog)
        line("fa-microchip", `${esc(s.prog.name)}: <strong>−${s.prog.amount} REZ</strong> <span>(${s.prog.before} → ${s.prog.after})</span>${s.prog.derezzed ? " – <strong>derezzed</strong>" : ""}`);
    if (s.vrizz)
        line("fa-bolt-lightning", `${esc(s.target.name)}: <strong>−1 NET Action</strong> <span>(next Turn, minimum 2)</span>`);
    if (s.burn)
        line("fa-fire", `${esc(s.target.name)}: <strong>On fire</strong> <span>(2 HP at the end of every Turn – a Meat Action puts it out)</span>`);
    if (s.stats)
        line("fa-brain", `${esc(s.target.name)}: <strong>${s.stats.list.map(x => `${x.stat.toUpperCase()} ${x.before} → ${x.after}`).join(" · ")}</strong> <span>(for the next hour, minimum 1)</span>`);
    if (s.poisonApplied)
        line("fa-skull-crossbones", `${esc(s.poisonApplied.name)} <strong>derezzed</strong> <span>(destroyed by Poison Flatline – delete it on the sheet if it is gone for good)</span>`);
    if (s.glue)
        line("fa-hand", `${esc(s.target.name)}: <strong>glued for ${s.glue.rounds} Round${s.glue.rounds === 1 ? "" : "s"}</strong> <span>(no going deeper, no safe Jack Out)</span>`);
    if (s.krash)
        line("fa-explosion", `${esc(s.target.name)}: <strong>forced out</strong> <span>(unsafe Jack Out – the rezzed Black ICE it met: see the "Unsafe Jack Out" card)</span>`);
    return lines.join("");
}
export function rvrCardHTML(s) {
    const def = RVR[s.action];
    const vsProgram = !!def?.program;
    const targetLabel = vsProgram ? `${s.target.name}'s ${s.program?.name}` : s.target.name;
    let body = "";
    const atkNote = s.flak && s.atk ? `<small class="cprnet-net-note">Flak: ${esc(s.target.name)}'s Flak lowers the program's ATK to 0.</small>` : "";
    body += section("attack", def?.program ? `${def.label} → ${s.program?.name}` : def?.label ?? "Attack", (s.runnerRoll?.html ?? "") + atkNote, "cprnet-net-same-title cprnet-attack-result " + rollOutcomeClass(s.state === "resolved" ? hit(s) : undefined));
    if (s.state === "cancelled")
        body += section("pending", "Cancelled", `<p class="cprnet-pending-status">Cancelled by the GM</p>`);
    else if (s.state === "waiting")
        body += section("pending", "Defense", `<p class="cprnet-pending-status">Waiting for ${esc(targetLabel)}: ${vsProgram ? `DEF ${s.program?.def ?? 0}` : "Interface"} + 1d10</p><div class="cprnet-net-controls cprnet-defense-controls" data-rvr-defend></div>`);
    else {
        body += section("evade", vsProgram ? `${s.program?.name} · DEF` : `${s.target.name} · Interface`, s.defRoll?.html ?? "", "cprnet-defense-result " + rollOutcomeClass(!hit(s)));
        const word = hit(s) ? "hits" : "misses";
        const summary = `${esc(s.runner.name)}'s ${esc(def?.label ?? "")} <span class="${hit(s) ? "cprnet-hit" : "cprnet-miss"}">${word}</span> ${esc(targetLabel)}`;
        const notes = [];
        if (hit(s) && def?.effect && !vsProgram)
            notes.push(def.effect);
        if (hit(s) && def?.brain && !s.applied) {
            const d = defenders(s);
            if (d.shield)
                notes.push(`${d.shield.name} (Shield) stops this brain damage and derezzes itself.`);
            else if (d.armor)
                notes.push(`${d.armor.name} (Armor): −4 brain damage.`);
        }
        body += section("result", "Result", `<p class="cprnet-combat-outcome"><span class="cprnet-net-controls" data-rvr-damage></span><i class="fas fa-network-wired cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${summary}</strong></p>`
            + notes.map(n => `<small class="cprnet-net-note">${esc(n)}</small>`).join(""));
        if (hit(s)) {
            const dmgLabel = s.action === "superglue" ? "Rounds" : s.action === "nervescrub" ? "INT / REF / DEX −" : vsProgram ? "REZ damage" : "Damage";
            const dmg = s.damage ? `<div class="cprnet-net-dmg"><span>${dmgLabel} (${esc(s.damage.formula)})</span><strong>${s.damage.total}</strong></div>` : "";
            const poison = s.action === "poison" ? `<p class="cprnet-net-applied"><i class="fas fa-microchip"></i> ${s.poison ? `Program hit: <strong>${esc(s.poison.name)}</strong> <span>(random)</span>` : `<span>No Non-Black ICE program installed to hit.</span>`}</p>` : "";
            body += section("netdamage", "Effect", dmg + poison + appliedLines(s) + `<div class="cprnet-damage-application"><div class="cprnet-net-controls cprnet-damage-controls" data-rvr-apply></div></div>`);
        }
    }
    return `<section class="rollcard cprnet-net-card"><div class="rollcard-top"><div class="cpr-block">${attackHeading(def?.label ?? "NET attack")}<div class="cprnet-net-floor-type">${vsProgram ? "Program" : "Netrunner"}</div></div></div><div class="cprnet-resolution-card">${body}</div></section>`;
}
/** GM side: a new roll / effect on a card (state lives in the message flag) */
export async function applyRvrPatch(message, s, patch, userId) {
    const user = game.users?.get(userId), gm = !!user?.isGM;
    const runner = sceneToken(s, "runner"), target = sceneToken(s, "target");
    if (patch.cancel) {
        if (!gm || s.state !== "waiting")
            return;
        s.state = "cancelled";
    }
    if (patch.defRoll) {
        if (s.state !== "waiting" || s.defRoll || !(gm || target?.actor?.testUserPermission(user, "OWNER")))
            return;
        s.defRoll = patch.defRoll;
        s.outcome = s.runnerRoll.total > s.defRoll.total ? "runner" : "target"; // the attacker has to beat the defense
        s.state = "resolved";
        // Poison Flatline: a random Non-Black ICE program installed on the target's deck
        if (s.action === "poison" && s.outcome === "runner") {
            const list = installedPrograms(target?.actor).filter(p => !isBlackIceProgram(p));
            const p = list[Math.floor(Math.random() * list.length)];
            s.poison = p ? { id: p.id, name: p.name } : null;
        }
    }
    if (patch.damage) {
        if (!hit(s) || s.damage || !(gm || runner?.actor?.testUserPermission(user, "OWNER")))
            return;
        s.damage = patch.damage;
    }
    if (patch.set) {
        if (!gm || s.state !== "resolved")
            return;
        for (const [key, value] of Object.entries(patch.set))
            if (["applied", "prog", "vrizz", "burn", "stats", "poisonApplied", "glue", "krash"].includes(key))
                s[key] = value ?? null;
    }
    await message.update({ content: rvrCardHTML(s), [`flags.${MODULE}.${CARD_FLAG}`]: s });
    const dice = [...(patch.defRoll?.dice ?? []).map(d => [d, patch.defRoll.roller]), ...(patch.damage?.dice ?? []).map(d => [d, patch.damage.roller])];
    for (const [json, roller] of dice)
        void showSavedDice([json], "publicroll", roller).catch(() => { });
}
// ---------- applying / undoing the effects (GM) ----------
const hpPath = "system.derivedStats.hp.value";
/** the actual changes of one effect – used by the card buttons and by the Jack Out summary */
async function undo(s, field, actor) {
    const t = actor ?? targetActor(s);
    const v = s[field];
    if (!v || !t)
        return;
    if (field === "applied") {
        if (v.amount)
            await t.update({ [hpPath]: Number(foundry.utils.getProperty(t, hpPath)) + v.amount });
        if (v.shield?.derezzed)
            await t.items.get(v.shield.id)?.update({ "system.isRezzed": true });
    }
    else if (field === "prog") {
        const p = t.items.get(v.id);
        if (p)
            await p.update({ [v.rezPath]: v.before, "system.isRezzed": v.wasRezzed });
    }
    else if (field === "vrizz") {
        const token = sceneToken(s, "target");
        if (token)
            await token.update({ [`flags.${MODULE}.netActionsPenalty.pending`]: Math.max(0, (Number(foundry.utils.getProperty(token, `flags.${MODULE}.netActionsPenalty.pending`)) || 0) - 1) });
    }
    else if (field === "burn") {
        if (v.statusId)
            await t.toggleStatusEffect(v.statusId, { active: false });
        await t.unsetFlag(MODULE, BURN_FLAG);
    }
    else if (field === "stats") {
        const changes = {};
        for (const x of v.list) {
            const now = Number(foundry.utils.getProperty(t, `system.stats.${x.stat}.value`));
            changes[`system.stats.${x.stat}.value`] = (Number.isFinite(now) ? now : x.after) + (x.before - x.after);
        }
        await t.update(changes);
    }
    else if (field === "poisonApplied") {
        await t.items.get(v.id)?.update({ "system.isRezzed": v.wasRezzed });
    }
    else if (field === "glue") {
        const token = sceneToken(s, "target");
        if (token)
            await token.update({ [`flags.${MODULE}.-=${GLUE_FLAG}`]: null });
    }
}
function controls(message, root, s) {
    const gm = !!game.user?.isGM;
    const runner = sceneToken(s, "runner"), target = sceneToken(s, "target");
    const def = RVR[s.action];
    // the target defends (its owner, otherwise the GM) · the GM may cancel
    const defend = root.querySelector("[data-rvr-defend]");
    if (defend && !defend.childElementCount && s.state === "waiting") {
        if (target && (gm || target.actor?.isOwner)) {
            const label = def.program ? `${s.program?.name} DEF` : `${s.target.name}: Interface`;
            defend.append(button(def.program ? `Roll ${label}` : "Defend (Interface)", "fa-shield-halved", async () => {
                const roll = def.program ? await statRoll(`${s.program?.name} · DEF`, s.program?.def ?? 0) : await statRoll(`${s.target.name} · Interface`, interfaceRank(target.actor));
                if (roll)
                    await send(message, { defRoll: roll });
            }, false, def.program ? `${s.program?.name}: DEF + 1d10` : `${s.target.name}: Interface + 1d10`));
        }
        if (gm)
            defend.append(button("Cancel", "fa-xmark", () => send(message, { cancel: true }), true, "", { className: "cprnet-cancel-exchange", kind: "cancel" }));
    }
    if (!hit(s))
        return;
    // the attacker (or the GM) rolls what the hit does
    const dmgSlot = root.querySelector("[data-rvr-damage]");
    if (dmgSlot && !dmgSlot.childElementCount && def.formula && !s.damage && (gm || runner?.actor?.isOwner))
        dmgSlot.append(button("Roll", "fa-droplet", async () => {
            const roll = await new Roll(def.formula).evaluate();
            await send(message, { damage: { total: roll.total, formula: def.formula, dice: [JSON.stringify(roll.toJSON())], roller: game.user.id } });
        }, false, `Roll ${def.formula}${s.action === "superglue" ? " (Rounds)" : ""}`, { iconOnly: true, className: "cprnet-result-damage" }));
    const slot = root.querySelector("[data-rvr-apply]");
    if (!slot || slot.childElementCount || !gm)
        return;
    const t = target?.actor ?? targetActor(s);
    const set = (patch) => send(message, { set: patch });
    const undoButton = (field, label) => slot.append(button(label, "fa-rotate-left", async () => { await undo(s, field); await set({ [field]: null }); }, true, "Undo", { kind: "reset" }));
    const apply = (label, icon, run, title) => slot.append(button(label, icon, run, true, title, { className: "cprnet-apply-damage" }));
    if (!t && !s.krash) {
        slot.append(document.createTextNode(`${s.target.name} is no longer in the NET.`));
        return;
    }
    // brain damage (Zap, Vrizzbolt, Hellbolt) – Shield / Armor
    if (def.brain && s.damage) {
        if (s.applied)
            undoButton("applied", "Undo damage");
        else {
            const d = defenders(s);
            if (d.shield)
                apply(`${d.shield.name} stops it – derez ${d.shield.name}`, "fa-shield-halved", async () => {
                    const p = t.items.get(d.shield.id);
                    await p?.update({ "system.isRezzed": false });
                    await set({ applied: { name: s.target.name, amount: 0, shield: { ...d.shield, derezzed: !!p } } });
                }, "Shield: stops the first brain damage of a Non-Black ICE program, then derezzes itself");
            else {
                const total = Math.max(0, s.damage.total - (d.armor ? 4 : 0));
                apply(`Apply ${total} to ${s.target.name}'s brain${d.armor ? ` (${d.armor.name} −4)` : ""}`, "fa-brain", async () => {
                    const before = Number(foundry.utils.getProperty(t, hpPath));
                    if (!Number.isFinite(before))
                        throw Error(`${t.name} has no HP value.`);
                    await t.update({ [hpPath]: before - total });
                    await set({ applied: { name: s.target.name, amount: total, before, after: before - total, armor: d.armor?.name } });
                }, "Direct damage to the Netrunner's HP – armor is ignored");
            }
        }
    }
    if (s.action === "vrizzbolt") {
        if (s.vrizz)
            undoButton("vrizz", "Undo −1 NET Action");
        else
            apply(`${s.target.name}: −1 NET Action next Turn`, "fa-bolt-lightning", async () => {
                if (!target)
                    throw Error(`${s.target.name} is no longer in the NET.`);
                const pending = Number(foundry.utils.getProperty(target, `flags.${MODULE}.netActionsPenalty.pending`)) || 0;
                await target.update({ [`flags.${MODULE}.netActionsPenalty.pending`]: pending + 1 });
                await set({ vrizz: true });
            }, "On the next Turn the NET Actions counter allows one less (minimum 2)");
    }
    if (s.action === "hellbolt") {
        if (s.burn)
            undoButton("burn", "Put out fire");
        else
            apply(`Set ${s.target.name} on fire`, "fa-fire", async () => {
                const id = onFireMildId();
                if (id)
                    await applyCombatStatus(t, id);
                await t.setFlag(MODULE, BURN_FLAG, { name: t.name, statusId: id ?? null, message: message.id });
                await set({ burn: { statusId: id ?? null } });
            }, "Hellbolt: 2 damage to HP whenever the Netrunner ends a Turn, until a Meat Action puts it out (a card asks the GM at every Turn end)");
    }
    if (s.action === "nervescrub" && s.damage) {
        if (s.stats)
            undoButton("stats", "Undo INT / REF / DEX");
        else
            apply(`Apply −${s.damage.total} to ${s.target.name}'s INT, REF, DEX`, "fa-brain", async () => {
                const changes = {}, list = [];
                for (const stat of ["int", "ref", "dex"]) {
                    const before = Number(foundry.utils.getProperty(t, `system.stats.${stat}.value`));
                    if (!Number.isFinite(before))
                        throw Error(`${t.name} has no ${stat.toUpperCase()} value.`);
                    const after = Math.max(1, before - s.damage.total);
                    changes[`system.stats.${stat}.value`] = after;
                    list.push({ stat, before, after });
                }
                await t.update(changes);
                await set({ stats: { list } });
            }, "For the next hour, minimum 1 – undo it here or in the Jack Out summary");
    }
    if (s.action === "poison" && s.poison) {
        if (s.poisonApplied)
            undoButton("poisonApplied", "Undo (rez it again)");
        else
            apply(`Derez ${s.poison.name} (Poison Flatline)`, "fa-skull-crossbones", async () => {
                const p = t.items.get(s.poison.id);
                if (!p)
                    throw Error(`${s.poison.name} is no longer installed.`);
                const wasRezzed = !!p.system?.isRezzed;
                await p.update({ "system.isRezzed": false });
                await set({ poisonApplied: { id: p.id, name: p.name, wasRezzed } });
            }, "Destroyed by the rules – this module only derezzes it; delete it on the sheet if it is gone for good");
    }
    if (s.action === "superglue" && s.damage) {
        if (s.glue)
            undoButton("glue", "Undo Superglue");
        else
            apply(`Glue ${s.target.name} for ${s.damage.total} Round${s.damage.total === 1 ? "" : "s"}`, "fa-hand", async () => {
                if (!target)
                    throw Error(`${s.target.name} is no longer in the NET.`);
                await target.update({ [`flags.${MODULE}.${GLUE_FLAG}`]: { rounds: s.damage.total, message: message.id } });
                await set({ glue: { rounds: s.damage.total } });
            }, "No going deeper, no safe Jack Out – counts down at every new Round");
    }
    if (s.action === "deckkrash") {
        if (!s.krash)
            apply(`Force ${s.target.name} out (unsafe Jack Out)`, "fa-explosion", async () => {
                if (!target)
                    throw Error(`${s.target.name} is no longer in the NET.`);
                if (!forceOut)
                    throw Error("Jack Out is not available.");
                await set({ krash: true });
                await forceOut(target);
            }, "Jacks the target out at once (unsafe) – an \"Unsafe Jack Out\" card lists every rezzed Black ICE it met, with GM buttons");
    }
    if (def.program && s.damage) {
        if (s.prog)
            undoButton("prog", "Undo REZ damage");
        else
            apply(`Apply ${s.damage.total} to ${s.program?.name}'s REZ`, "fa-microchip", async () => {
                const p = t.items.get(s.program?.id);
                if (!p)
                    throw Error(`${s.program?.name} is no longer installed.`);
                const before = progRez(p);
                if (!Number.isFinite(before))
                    throw Error(`${p.name} has no REZ value.`);
                const after = Math.max(0, before - s.damage.total), derezzed = after <= 0, wasRezzed = !!p.system?.isRezzed;
                await p.update({ [progRezPath(p)]: after, ...(derezzed ? { "system.isRezzed": false } : {}) });
                await set({ prog: { id: p.id, name: p.name, rezPath: progRezPath(p), before, after, amount: before - after, derezzed, wasRezzed } });
            }, "Subtract the damage from the program's REZ – at 0 it is derezzed");
    }
}
/** DeckKRASH: how the target is jacked out (set by the NET window code) */
let forceOut;
export function setForceOut(fn) { forceOut = fn; }
export function decorateRvr(message, root, s) {
    root.classList.add("cprnet-combat-message", "cprnet-net-message");
    root.dataset.cprnetExchangeState = s.state;
    root.dataset.cprnetOutcome = s.outcome === "runner" ? "hit" : s.outcome ? "miss" : "none";
    // left column like the other NET cards: attacker ↓ action ↓ target
    const sender = root.querySelector(".message-sender");
    if (sender) {
        sender.textContent = s.runner?.name ?? "";
        sender.parentElement?.querySelector(".cprnet-net-target")?.remove();
        const info = document.createElement("div");
        info.className = "cprnet-net-target";
        info.innerHTML = `<span class="cprnet-net-arrow">↓</span><span class="cprnet-net-action">${esc(RVR[s.action]?.label ?? "")}</span><strong>${esc(s.program ? `${s.target?.name} · ${s.program.name}` : s.target?.name ?? "")}</strong>${s.target?.img ? `<img src="${esc(s.target.img)}" alt="" class="is-token">` : ""}`;
        sender.after(info);
    }
    controls(message, root, s);
}
// ---------- Jack Out summary (the target's side) ----------
const FIELDS = ["applied", "prog", "burn", "stats", "poisonApplied"];
export function rvrLabel(s, field) {
    const v = s[field];
    if (!v)
        return "";
    if (field === "applied")
        return v.shield ? `${v.shield.name} derezzed (stopped ${s.runner.name}'s ${RVR[s.action]?.label})` : `${s.target.name}: −${v.amount} HP – ${s.runner.name}'s ${RVR[s.action]?.label}`;
    if (field === "prog")
        return `${v.name}: −${v.amount} REZ${v.derezzed ? ", derezzed" : ""} – ${s.runner.name}'s ${RVR[s.action]?.label}`;
    if (field === "burn")
        return `${s.target.name}: on fire – ${s.runner.name}'s Hellbolt`;
    if (field === "stats")
        return `${s.target.name}: ${v.list.map(x => `${x.stat.toUpperCase()} ${x.before}→${x.after}`).join(", ")} – ${s.runner.name}'s Nervescrub`;
    if (field === "poisonApplied")
        return `${v.name}: derezzed – Poison Flatline${DESTROYED_NOTE}`;
    return "";
}
/** what of this run is still applied to the Netrunner who jacks out (as the target of other Netrunners) */
export function rvrSummaryEntries(token) {
    const entries = [];
    for (const message of Array.from(game.messages ?? [])) {
        const s = foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`);
        if (s?.type !== "rvr" || s.target?.token !== token.id || s.scene !== token.parent?.id)
            continue;
        for (const field of FIELDS)
            if (s[field] && !(field === "applied" && !s.applied.amount && !s.applied.shield)) // Armor took it all: nothing to undo
                entries.push({ message: message.id, field, label: rvrLabel(s, field), rvr: true });
    }
    return entries;
}
export async function rvrUndo(message, field, actor) {
    const s = foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`);
    if (!s?.[field] || !game.user?.isGM)
        return;
    await undo(s, field, actor);
    await send(message, { set: { [field]: null } });
}
// ---------- Hellbolt: burning at every Turn end ----------
/** primary GM, when a Turn ends: a burning Netrunner gets a small card – Apply 2 damage / put out */
export async function burnTick(combat) {
    if (primaryGM()?.id !== game.user?.id)
        return;
    const id = combat.previous?.combatantId;
    const combatant = id ? combat.combatants.get(id) : undefined;
    if (!combatant)
        return;
    // the combatant is the Netrunner's meat body or its NET token – an unlinked NET token has its own actor copy
    const sourceUuid = combatant.token?.uuid;
    const candidates = [combatant.actor, ...(game.scenes ?? []).flatMap(sc => Array.from(sc.tokens ?? [])
            .filter(t => sourceUuid && foundry.utils.getProperty(t, `flags.${MODULE}.netrun.source`) === sourceUuid).map(t => t.actor))];
    const actor = candidates.find(a => a?.getFlag(MODULE, BURN_FLAG));
    // with the On Fire status the 2 HP per turn come from the status itself (Combat Tools) – no reminder card then
    if (!actor || actor.getFlag(MODULE, BURN_FLAG)?.statusId)
        return;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
        content: tickHTML(actor.name, {}), flags: { [MODULE]: { [TICK_FLAG]: { actor: actor.uuid, name: actor.name } } } });
}
function tickHTML(name, t) {
    const state = t.out ? `<p class="cprnet-net-applied"><i class="fas fa-fire-extinguisher"></i> <strong>Put out</strong></p>` : t.applied ? `<p class="cprnet-net-applied"><i class="fas fa-fire"></i> ${esc(name)}: <strong>−2 HP</strong> <span>(${t.applied.before} → ${t.applied.after})</span></p>` : "";
    return `<section class="rollcard cprnet-net-card"><div class="rollcard-top"><div class="cpr-block">${attackHeading("On fire")}<div class="cprnet-net-floor-type">Hellbolt</div></div></div><div class="cprnet-resolution-card">`
        + section("netdamage", "End of Turn", `<p class="cprnet-pending-status">${esc(name)} ends the Turn burning: 2 damage to HP – unless a Meat Action put it out.</p>${state}<div class="cprnet-damage-application"><div class="cprnet-net-controls cprnet-damage-controls" data-burn-tick></div></div>`) + `</div></section>`;
}
export function decorateTick(message, root) {
    const t = message.getFlag(MODULE, TICK_FLAG);
    const slot = root.querySelector("[data-burn-tick]");
    if (!t || !slot || slot.childElementCount || !game.user?.isGM)
        return;
    root.classList.add("cprnet-combat-message", "cprnet-net-message");
    const save = (patch) => message.update({ content: tickHTML(t.name, { ...t, ...patch }), [`flags.${MODULE}.${TICK_FLAG}`]: { ...t, ...patch } });
    const actor = () => fromUuid(t.actor);
    if (!t.applied && !t.out)
        slot.append(button(`Apply 2 to ${t.name}`, "fa-fire", async () => {
            const a = await actor();
            const before = Number(foundry.utils.getProperty(a, hpPath));
            if (!a || !Number.isFinite(before))
                throw Error(`${t.name} has no HP value.`);
            await a.update({ [hpPath]: before - 2 });
            await save({ applied: { before, after: before - 2 } });
        }, true, "2 damage to HP", { className: "cprnet-apply-damage" }));
    else if (t.applied)
        slot.append(button("Undo", "fa-rotate-left", async () => {
            const a = await actor();
            await a?.update({ [hpPath]: Number(foundry.utils.getProperty(a, hpPath)) + 2 });
            await save({ applied: null });
        }, true, "Give the 2 HP back", { kind: "reset" }));
    if (!t.out)
        slot.append(button("Put out (Meat Action)", "fa-fire-extinguisher", async () => {
            const a = await actor();
            const burning = a?.getFlag(MODULE, BURN_FLAG);
            if (burning?.statusId)
                await a.toggleStatusEffect(burning.statusId, { active: false });
            await a?.unsetFlag(MODULE, BURN_FLAG);
            // the Hellbolt card shows it as put out too
            const card = burning?.message ? game.messages?.get(burning.message) : undefined;
            if (card)
                await send(card, { set: { burn: null } });
            await save({ out: true });
        }, true, "The Netrunner spent a Meat Action to put the fire out", { kind: "reset" }));
}
export const glueOf = (token) => { const g = foundry.utils.getProperty(token, `flags.${MODULE}.${GLUE_FLAG}`); return g && g.rounds > 0 ? g : undefined; };
export { TICK_FLAG };

// ---------- Unsafe Jack Out (DeckKRASH, "Unsafe Jack Out" in the menu) ----------
// The Netrunner suffers the effect of every enemy Black ICE still rezzed that it met – here: every Black ICE that had a card
// with this Netrunner during the run. No attack roll: the GM rolls each damage and applies it with a button (Undo there and
// in the Jack Out summary). The NET token is gone by then: everything goes to the Netrunner's character.
const UNSAFE_FIELDS = ["applied", "burn", "progApplied", "skunk"];
const iceFormula = (text) => String(text ?? "").match(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/i)?.[1]?.replace(/\s+/g, "");
/** the Black ICE this Netrunner token met on a card – still on the scene and rezzed (Demons are not Black ICE) */
export function iceMetOnCards(token) {
    const ids = new Set();
    for (const message of Array.from(game.messages ?? [])) {
        const c = foundry.utils.getProperty(message, `flags.${MODULE}.${CARD_FLAG}`);
        if (!c || c.type === "rvr" || c.type === "unsafe" || c.state === "cancelled" || c.scene !== token.parent?.id || c.runner?.token !== token.id)
            continue;
        if (c.ice?.token)
            ids.add(c.ice.token);
        for (const row of c.rows ?? [])
            if (row.ice?.token)
                ids.add(row.ice.token);
    }
    return [...ids].map(id => token.parent.tokens.get(id)).filter(t => {
        if (!t?.actor || String(t.actor.type) !== "blackIce")
            return false;
        const path = damageTarget(t.actor, true);
        return !path || Number(foundry.utils.getProperty(t.actor, path)) > 0;
    });
}
/** primary GM, before the token is removed: the card (returns its id) */
export async function postUnsafeCard(token, reason) {
    const actorUuid = token.actorLink ? token.actor?.uuid : game.actors?.get(token.actorId)?.uuid ?? token.actor?.uuid;
    const actor = token.actor;
    const rows = iceMetOnCards(token).map(ice => {
        const effect = iceEffect(ice.actor) || "";
        const progKind = progKindOf(ice.actor, ice.name);
        let prog;
        if (progKind) { // Asp / Raven: a rezzed program · Dragon / Sabertooth / Killer: one with REZ left
            const list = installedPrograms(actor, progKind === "derez").filter(p => progKind === "derez" || progRez(p) > 0);
            const p = list[Math.floor(Math.random() * list.length)];
            prog = p ? { id: p.id, name: p.name } : null;
        }
        return { ice: side(ice), effect, formula: iceFormula(effect) ?? null, special: specialOf(ice.actor, ice.name) ?? null, progKind: progKind ?? null, prog, skunkIce: isSkunk(ice.actor, ice.name) };
    });
    const s = { type: "unsafe", scene: token.parent.id, reason: reason || "Unsafe Jack Out", runner: side(token), actor: actorUuid, rows, state: "resolved" };
    const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ token, actor: token.actor }), content: unsafeHTML(s), flags: { [MODULE]: { [CARD_FLAG]: s } } });
    return message?.id;
}
function unsafeHTML(s) {
    const head = `<div class="rollcard-top"><div class="cpr-block">${attackHeading("Unsafe Jack Out")}<div class="cprnet-net-floor-type">${esc(s.reason)}</div></div></div>`;
    let body = section("result", "Result", `<p class="cprnet-combat-outcome"><i class="fas fa-plug-circle-exclamation cprnet-net-result-icon" aria-hidden="true"></i><strong class="cprnet-result-summary">${esc(s.runner.name)} <span class="cprnet-miss">jacks out unsafely</span></strong></p>`
        + `<small class="cprnet-net-note">${s.rows.length ? "The Netrunner suffers the effect of every enemy Black ICE still rezzed that it met – no attack roll. The GM rolls and applies each one." : "No rezzed Black ICE met on a card in this run – no effects."}</small>`);
    s.rows.forEach((row, i) => {
        const dmg = row.damage ? `<div class="cprnet-net-dmg"><span>Damage (${esc(row.damage.formula)})</span><strong>${row.damage.total}</strong></div>` : "";
        const target = row.progKind === "damage" ? "" : appliedHTML(row.applied) + burnHTML(row.burn);
        body += section("netdamage", row.ice.name, `<p class="cprnet-combat-outcome"><span class="cprnet-net-controls" data-unsafe-roll="${i}"></span><small class="cprnet-net-note">${esc(row.effect || "No effect text on the sheet – apply it by hand.")}</small></p>`
            + dmg + target + `<div class="cprnet-damage-application"><div class="cprnet-net-controls cprnet-damage-controls" data-unsafe-apply="${i}"></div></div>`)
            + (row.progKind ? programSection(row.prog, row.progApplied, `data-unsafe-prog="${i}"`) : "")
            + (row.skunkIce ? skunkSection(row.skunk, `data-unsafe-skunk="${i}"`) : "");
    });
    return `<section class="rollcard cprnet-net-card">${head}<div class="cprnet-resolution-card">${body}</div></section>`;
}
/** GM only: a damage roll or an effect of one row */
export async function applyUnsafePatch(message, s, patch, userId) {
    if (!game.users?.get(userId)?.isGM)
        return;
    if (patch.summary)
        s.summary = patch.summary;
    const row = s.rows?.[patch.row];
    if (row && patch.set)
        for (const [key, value] of Object.entries(patch.set))
            if (["damage", ...UNSAFE_FIELDS].includes(key))
                row[key] = value ?? null;
    await message.update({ content: unsafeHTML(s), [`flags.${MODULE}.${CARD_FLAG}`]: s });
    // the Jack Out summary reads this card live – draw it again
    const summary = s.summary ? game.messages?.get(s.summary) : undefined;
    if (summary && patch.set)
        await summary.update({ [`flags.${MODULE}.summaryTouched`]: Date.now() });
    for (const json of patch.set?.damage?.dice ?? [])
        void showSavedDice([json], "publicroll", patch.set.damage.roller).catch(() => { });
}
/** reverses one effect of a row (card Undo and summary Undo) */
async function unsafeUndo(message, s, i, field) {
    const row = s.rows?.[i], v = row?.[field];
    const actor = s.actor ? await fromUuid(s.actor) : undefined;
    if (!v || !actor)
        return;
    if (field === "applied") {
        if (v.kind === "stats") {
            const changes = {};
            for (const x of v.stats ?? []) {
                const now = Number(foundry.utils.getProperty(actor, `system.stats.${x.stat}.value`));
                changes[`system.stats.${x.stat}.value`] = (Number.isFinite(now) ? now : x.after) + (x.before - x.after);
            }
            await actor.update(changes);
        }
        else
            await actor.update({ [hpPath]: Number(foundry.utils.getProperty(actor, hpPath)) + v.amount });
    }
    else if (field === "burn") {
        if (v.statusId)
            await actor.toggleStatusEffect(v.statusId, { active: false });
    }
    else if (field === "progApplied") {
        const p = actor.items.get(v.id);
        if (p)
            await p.update(v.kind === "derez" ? { "system.isRezzed": v.wasRezzed } : { [v.rezPath]: v.before, "system.isRezzed": v.wasRezzed });
    }
    else if (field === "skunk") {
        if (actor.effects?.get(v.effectId))
            await actor.deleteEmbeddedDocuments("ActiveEffect", [v.effectId]);
    }
    await send(message, { row: i, set: { [field]: null } });
}
export function decorateUnsafe(message, root, s) {
    root.classList.add("cprnet-combat-message", "cprnet-net-message");
    root.dataset.cprnetExchangeState = "resolved";
    root.dataset.cprnetOutcome = "miss";
    if (!game.user?.isGM)
        return;
    void (async () => {
        const actor = s.actor ? await fromUuid(s.actor) : undefined;
        s.rows.forEach((row, i) => {
            const set = (patch) => send(message, { row: i, set: patch });
            const rollSlot = root.querySelector(`[data-unsafe-roll="${i}"]`);
            if (rollSlot && !rollSlot.childElementCount && row.formula && !row.damage)
                rollSlot.append(button("Roll", "fa-droplet", async () => {
                    const roll = await new Roll(row.formula).evaluate();
                    await set({ damage: { total: roll.total, formula: row.formula, dice: [JSON.stringify(roll.toJSON())], roller: game.user.id } });
                }, true, `Roll ${row.ice.name}'s damage ${row.formula}`, { iconOnly: true, className: "cprnet-result-damage" }));
            if (!actor)
                return;
            const who = { actor, name: s.runner.name };
            const apply = root.querySelector(`[data-unsafe-apply="${i}"]`);
            if (apply && !apply.childElementCount && row.damage && row.progKind !== "damage")
                applyButtons(apply, { special: row.special ?? undefined, total: row.damage.total, runner: who, applied: row.applied, burn: row.burn,
                    hp: a => set({ applied: a }), setApplied: a => set({ applied: a }), setBurn: b => set({ burn: b }) });
            const prog = root.querySelector(`[data-unsafe-prog="${i}"]`);
            if (prog && !prog.childElementCount && row.prog)
                programControls(prog, { kind: row.progKind, pick: row.prog, applied: row.progApplied, damage: row.damage?.total, runnerActor: actor, choiceKey: `${message.id}-${i}`,
                    set: a => set({ progApplied: a }), undo: () => unsafeUndo(message, s, i, "progApplied") });
            const skunk = root.querySelector(`[data-unsafe-skunk="${i}"]`);
            if (skunk && !skunk.childElementCount)
                skunkControls(skunk, { applied: row.skunk, runner: who, ice: row.ice, set: a => set({ skunk: a }), undo: () => unsafeUndo(message, s, i, "skunk") });
        });
        if (!actor && s.rows.length)
            root.querySelector(".cprnet-resolution-card")?.insertAdjacentHTML("beforeend", `<small class="cprnet-net-note">The Netrunner's character was not found – apply the effects by hand.</small>`);
    })().catch(error => console.error(MODULE, "Unsafe Jack Out", error));
}
function unsafeLabel(s, row, field) {
    const v = row[field];
    if (field === "applied")
        return v.kind === "stats" ? `${s.runner.name}: ${(v.stats ?? []).map(x => `${x.stat.toUpperCase()} ${x.before}→${x.after}`).join(", ")} – ${row.ice.name} (unsafe Jack Out)` : `${s.runner.name}: −${v.amount} HP – ${row.ice.name} (unsafe Jack Out)`;
    if (field === "burn")
        return `${s.runner.name}: On Fire (Mild) – ${row.ice.name} (unsafe Jack Out)`;
    if (field === "progApplied")
        return (v.kind === "derez" ? `${v.name}: derezzed – ${row.ice.name} (unsafe Jack Out)` : `${v.name}: −${v.amount} REZ${v.derezzed ? ", derezzed" : ""} – ${row.ice.name} (unsafe Jack Out)`)
            + (destroyedByRules(v, row.ice.name) ? DESTROYED_NOTE : "");
    return `${s.runner.name}: Slide −2 – ${row.ice.name} (unsafe Jack Out)`;
}
/** Jack Out summary: the effects of the Unsafe Jack Out card, read live */
export function unsafeSummaryRows(list, data, render) {
    const card = game.messages?.get(data.unsafe);
    const s = card ? foundry.utils.getProperty(card, `flags.${MODULE}.${CARD_FLAG}`) : undefined;
    if (!s)
        return;
    s.rows.forEach((row, i) => {
        for (const field of UNSAFE_FIELDS) {
            if (!row[field])
                continue;
            const el = document.createElement("div");
            el.className = "cprnet-net-summary-row";
            el.innerHTML = `<span class="cprnet-net-summary-label">${esc(unsafeLabel(s, row, field))}</span>`;
            if (game.user?.isGM)
                el.append(button("Undo", "fa-rotate-left", async () => { await unsafeUndo(card, s, i, field); render(); }, true, "Undo this effect", { kind: "reset" }));
            list.append(el);
        }
    });
    if (!list.childElementCount)
        list.insertAdjacentHTML("beforeend", `<div class="cprnet-net-summary-row"><span class="cprnet-net-note">Unsafe Jack Out: nothing applied yet – the effects appear here once the GM applies them on the card.</span></div>`);
}
/** the summary posted after the card: link them (the card redraws the summary when an effect changes) */
export async function linkUnsafeSummary(cardId, summary) {
    const card = cardId ? game.messages?.get(cardId) : undefined;
    if (card && summary)
        await send(card, { summary: summary.id });
}
