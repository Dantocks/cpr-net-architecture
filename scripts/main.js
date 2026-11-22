/* NET Architecture – Cyberpunk RED · Foundry V12
 * The NET architecture of Pneuma's Combat Tools (GM edit 0.9.30-gmedit.106) as a module of its own:
 * Access Points, Jack In / Jack Out, the NET window with floors, branches, passages, Black ICE and Demons,
 * NET actions with chat cards, Going Quiet. Works without Pneuma's Combat Tools.
 * v1.0.1: right-click on an Access Point keeps your selected Netrunner (as in the Combat Tools).
 * v1.0.4: Banhammer attacks Black ICE / Demons (Interface + 1 + 1d10 vs DEF, 2d6 REZ).
 * v1.0.3: GitHub manifest / download links.
 * v1.0.2: runs side by side with the original Pneuma's Combat Tools (own CSS classes and data attributes,
 *   so neither touches the other's chat cards or styles). Only the GM edit of the Combat Tools, which has the
 *   NET architecture built in, switches this module off. */
import { MODULE } from "./support.js";
import { registerAccessPoints, isAccessPoint } from "./access-point.js";
import { registerNetActions } from "./net-actions.js";
import { registerChatButtons } from "./chat-buttons.js";

const OLD = "pneuma-combattools";
/** only the GM edit of the Combat Tools contains the NET architecture – the original Combat Tools do not,
 *  so with the original both run side by side (own flags, own CSS classes, own socket) */
const combatToolsWithNet = () => { const ct = game.modules.get(OLD); return !!ct?.active && /gmedit/i.test(String(ct.version ?? "")); };

Hooks.once("init", () => {
    if (combatToolsWithNet()) {
        // the Combat Tools have the same NET architecture built in – both together would do everything twice
        Hooks.once("ready", () => ui.notifications.warn("NET Architecture: the GM edit of Pneuma's Combat Tools is active and already contains the NET architecture – this module stays off. Deactivate one of the two."));
        return;
    }
    registerAccessPoints();
    registerNetActions();
    registerChatButtons();
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
