/* NET Architecture – Cyberpunk RED · Foundry V12
 * The NET architecture of Pneuma's Combat Tools (GM edit 0.9.30-gmedit.106) as a module of its own:
 * Access Points, Jack In / Jack Out, the NET window with floors, branches, passages, Black ICE and Demons,
 * NET actions with chat cards, Going Quiet. Works without Pneuma's Combat Tools.
 * v1.0.1: right-click on an Access Point keeps your selected Netrunner (as in the Combat Tools).
 * v1.8.1: option "NET: count only in combat" (on): NET Actions and Sword / Banhammer uses are only counted while the
 *   Netrunner (NET token or body) is in a started combat – another combat somewhere else no longer counts. Blocking when
 *   used up: only in the Netrunner's combat.
 * v1.8.0: Sword / Banhammer: counter in the button (copies left this round / installed) – each installed copy attacks once
 *   per round (CP:R p. 200), back to full every new round; used up: players can't attack, the GM may confirm. Cancelling a
 *   card in the same round gives its NET Action and its Sword / Banhammer use back.
 * v1.7.6: Programs dropdown: the whole row rezzes / derezzes, only the name opens the program.
 * v1.7.5: Programs dropdown: only the program's name is a link (hover: cyan, underlined) – opens the program.
 * v1.7.4: Programs dropdown: the switch on the left rezzes / derezzes, a click on the name opens the program.
 * v1.7.3: the "Programs" toggle in the token menu looks like the other menu buttons.
 * v1.7.2: stealthed Netrunners stand at the left / right edge of a floor; visible ones only count the visible ones for
 *   their spot – a visible Netrunner's position no longer gives a hidden one away.
 * v1.7.1: option "Going Quiet – stealth cards only for the Netrunner's owners" (on): Quiet Jack In, Evade Detection
 *   and a Watcher's search are hidden (with their dice) from every player who does not own the stealthed Netrunner.
 * v1.7.0: option "NET: Range to the Access Point" (6 m / 8 m / off): no Jack In out of range (the GM may confirm
 *   anyway); the body leaving the range during a run gives the GM an "Out of range" card with "Unsafe Jack Out".
 * v1.6.3: right-click menu moves back inside the NET window when the Programs dropdown opens (was cut off at the bottom).
 * v1.6.2: Programs dropdown stays open after a click – the entry shows its new state (and the count in the header).
 * v1.6.1: NET window: a stealthed Netrunner (also while jacking in quietly) is only shown to the GM and its owners –
 *   the other players don't see it.
 * v1.6.0: Going Quiet – option "GM rolls hidden" (on): Watcher names and the GM's counter-rolls (Black ICE PER, Watcher
 *   Interface) only for the GM, no 3D dice for players; NPC Netrunner Interface from the NET role rank; Watchers get the
 *   Pathfinder bonus; Unsafe Jack Out ignores Black ICE slipped past with Evade Detection (while still stealthed).
 *   NPC Netrunners in the architecture: GM moves / searches / runner vs runner. Player NET moves go through the GM's
 *   client. Access Point: eye icon for players, Jack In again reopens the window. Programs dropdown (rez / derez,
 *   1 NET Action; sheet changes by players count too), all programs derezzed at Jack In, NPC Netrunner hover text.
 * v1.5.13: GM: "Jack Out" / "Unsafe Jack Out" from the right-click menu keep the NET window open (the footer button still
 *   closes it).
 * v1.5.12: the right-click menu lies above the "Keys control the NET" note.
 * v1.5.11: performance – the NET window redraws once per frame instead of once per changed document (Reveal
 *   everything, Reset Net Arch …), and only rebuilds tiles / tokens when something in them changed.
 * v1.5.10: On Fire: the "Burn −2 HP" button and the Hellbolt turn-end card are gone (the status deals the 2 HP itself);
 *   "Undo On Fire" is now "Put out fire".
 * v1.5.9: GM button "Reveal everything" (between "Show to Players" and "Save Start").
 * v1.5.8: players' NET window is lower by the GM button row – the map keeps the same size as the GM's.
 * v1.5.7: Fix: a Black ICE / Demon moved onto a floor with ICE no longer lands on top of it (the target floor was not
 *   found). NET window footer, Concept D: row 1 always the same, status slot fixed, help as "?" tooltip; GM row below.
 * v1.5.6: "Toggle Combat State" opens the combat bar of Combat HUD dX when that module is active.
 * v1.5.5: "Toggle Combat State" in the NET window uses the encounter of the scene the GM is viewing (activated if
 *   needed, created if there is none) and opens a minimized Combat Tools combat bar.
 * v1.5.4: Black ICE / Demon moves run one after another (no more stacked tokens on a floor; a held arrow key moves
 *   one floor per press). Jack Out summary: programs the rules destroy (Asp, Dragon / Killer / Sabertooth below 1 REZ,
 *   Poison Flatline) are marked "destroyed – delete it and buy it again".
 * v1.5.3: GM: "Toggle Combat State" also in the right-click menu of every Netrunner token.
 * v1.5.2: GM button "Unplug all Netrunners" (next to "Reset Net Arch"): every Netrunner jacks out, other player tokens
 *   are removed – only Black ICE and Demons stay.
 * v1.5.1: Unsafe Jack Out (DeckKRASH, "Unsafe Jack Out" in the Netrunner's menu): a card with every rezzed Black ICE
 *   the Netrunner met on a card – GM buttons to roll and apply each effect, Undo there and in the Jack Out summary.
 * v1.5.0: new NET window controls (left-click: active token / move, right-click a token: actions, Tab, arrow keys
 *   only while the window has the focus; GM floor menu) and Netrunner vs Netrunner (Zap, Anti-Personnel programs,
 *   attacks on programs, Flak / Shield / Armor, Hellbolt burning, Superglue, DeckKRASH, Jack Out summary).
 * v1.4.0: the NET Actions counter counts by itself (Jack In 1 / quiet 2, every NET Action the Netrunner chooses) and
 *   stops further actions when used up during a combat – the GM may go on anyway.
 * v1.3.0: NET Actions counter in the Netrunner's NET window (▲ / ▼, limit by Interface rank, 0 at every new round).
 * v1.2.3: NET window: the map can be dragged freely again (as before 1.2.2); the stealth frame stays on top of it.
 * v1.2.2: NET window: the architecture could not be dragged out of the window; the red / turquoise stealth
 *   frame stays on top of the map.
 * v1.2.1: fix: v1.2.0 could freeze Foundry (endless loop in the chat card look).
 * v1.2.0: NET cards look like before the split again – their parts also carry the pneuma-… class names that
 *   Pneuma's Visual Tools and the Combat Tools style.
 * v1.1.1: no libWrapper conflict with the Combat Tools – their dice helpers are used when they are active,
 *   otherwise the dice handler is wrapped through libWrapper (if installed).
 * v1.1.0: works with the GM edit of the Combat Tools from gmedit.108 on (NET architecture removed there) – takes over its NET data.
 * v1.0.5: no warning any more when the GM edit of the Combat Tools is active (the module just stays off quietly).
 * v1.0.4: Banhammer attacks Black ICE / Demons (Interface + 1 + 1d10 vs DEF, 2d6 REZ).
 * v1.0.3: GitHub manifest / download links.
 * v1.0.2: runs side by side with the original Pneuma's Combat Tools (own CSS classes and data attributes,
 *   so neither touches the other's chat cards or styles). Only the GM edit of the Combat Tools, which has the
 *   NET architecture built in, switches this module off. */
import { MODULE } from "./support.js";
import { registerAccessPoints, isAccessPoint } from "./access-point.js";
import { registerNetActions } from "./net-actions.js";
import { registerPrograms } from "./programs.js";
import { registerChatButtons } from "./chat-buttons.js";
import { registerLook } from "./look.js";

const OLD = "pneuma-combattools";
/** only the GM edit of the Combat Tools up to gmedit.107 contains the NET architecture – the original Combat Tools and gmedit.108+ do not,
 *  so with the original both run side by side (own flags, own CSS classes, own socket) */
const combatToolsWithNet = () => {
    const ct = game.modules.get(OLD), edit = /gmedit\.(\d+)/i.exec(String(ct?.version ?? ""));
    return !!ct?.active && !!edit && Number(edit[1]) <= 107;   // from gmedit.108 on the NET architecture is only in this module
};

Hooks.once("init", () => {
    if (combatToolsWithNet()) {
        // the Combat Tools have the same NET architecture built in – both together would do everything twice
        return;
    }
    registerAccessPoints();
    registerNetActions();
    registerPrograms();
    registerChatButtons();
    registerLook();
    // Right-click on an Access Point works like in Pneuma's Combat Tools: the menu opens WITHOUT selecting the
    // Access Point, so your Netrunner stays selected (Jack In takes the selected token). This applies to a GM while
    // the Access Point is not selected, to players who do not own it, and to everyone with Shift held.
    // Normal right-click behaviour stays for all other tokens.
    const Base = CONFIG.Token.objectClass;
    CONFIG.Token.objectClass = class NetArchToken extends Base {
        netClick = false;
        canOpenNetMenu() {
            return !!isAccessPoint(this) && canvas.activeLayer === canvas.tokens && this.isVisible && !this.isPreview
                && canvas.controls?.ruler?.state !== Ruler.STATES.MEASURING;
        }
        useNetMenu(event) {
            return this.canOpenNetMenu() && ((game.user?.isGM && !this.controlled) || !this.isOwner || !!event?.shiftKey);
        }
        _canHUD(user, event) {
            return super._canHUD(user, event) || this.useNetMenu(event);
        }
        _onClickRight(event) {
            this.netClick = this.useNetMenu(event);
            if (!this.netClick) return super._onClickRight(event);
            event.stopPropagation();   // no control(): the other selected tokens stay selected
        }
        _onUnclickRight(event) {
            if (!this.netClick) return super._onUnclickRight(event);
            this.netClick = false;
            event.stopPropagation();
            if (!this.canOpenNetMenu()) return;
            const hud = canvas.tokens.hud;
            if (hud.object === this) hud.clear();
            else hud.bind(this);
        }
        _onClickRight2(event) {
            if (!this.useNetMenu(event)) return super._onClickRight2(event);
            event.stopPropagation();   // no token sheet / config on a double right-click
        }
    };
    // a player's HUD on an Access Point they do not own shows only the NET buttons (the native ones would fail)
    Hooks.on("renderTokenHUD", (hud, html) => {
        const token = hud.object;
        const foreign = !game.user.isGM && !!token && !token.isOwner && !!isAccessPoint(token);   // GM keeps all buttons
        (html[0] ?? html).classList?.toggle("cpr-net-foreign-ap", foreign);
    });
});

// ---------- take over the NET data of Pneuma's Combat Tools (once, GM) ----------
const DOC_KEYS = { scene: ["netStart"], tile: ["netFloor", "netPassed"], token: ["accessPoint", "netrun"] };
const SETTINGS = ["netGoingQuiet", "netRulesJournal", "netAutoLyingInWait"];
Hooks.once("ready", async () => {
    if (combatToolsWithNet() || !game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    if (game.settings.get(MODULE, "migrated")) return;
    let docs = 0;
    const copy = (doc, keys) => {
        const old = doc.flags?.[OLD] ?? {}, now = doc.flags?.[MODULE] ?? {};
        const out = {};
        for (const k of keys) if (old[k] !== undefined && now[k] === undefined) out[`flags.${MODULE}.${k}`] = foundry.utils.deepClone(old[k]);
        return Object.keys(out).length ? out : null;
    };
    try {
        for (const scene of game.scenes) {
            const s = copy(scene, DOC_KEYS.scene);
            if (s) { await scene.update(s); docs++; }
            const tiles = scene.tiles.map(t => { const u = copy(t, DOC_KEYS.tile); return u ? { _id: t.id, ...u } : null; }).filter(Boolean);
            if (tiles.length) { await scene.updateEmbeddedDocuments("Tile", tiles); docs += tiles.length; }
            const tokens = scene.tokens.map(t => { const u = copy(t, DOC_KEYS.token); return u ? { _id: t.id, ...u } : null; }).filter(Boolean);
            if (tokens.length) { await scene.updateEmbeddedDocuments("Token", tokens); docs += tokens.length; }
        }
        const stored = game.settings.storage.get("world");
        for (const key of SETTINGS) {
            const old = stored?.getSetting?.(`${OLD}.${key}`);
            if (old) { try { await game.settings.set(MODULE, key, JSON.parse(old.value)); } catch (e) { await game.settings.set(MODULE, key, old.value); } }
        }
        await game.settings.set(MODULE, "migrated", true);
        if (docs) ui.notifications.info(`NET Architecture: NET data of Pneuma's Combat Tools taken over (${docs} scenes / tiles / tokens).`);
    } catch (error) {
        console.error(MODULE, "taking over the Combat Tools data", error);
    }
});
Hooks.once("init", () => {
    game.settings.register(MODULE, "migrated", { scope: "world", config: false, type: Boolean, default: false });
});
