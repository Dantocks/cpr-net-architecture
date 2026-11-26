/* NET Architecture – the familiar look.
 * The module's chat cards use their own class names (cprnet-…), so the Combat Tools never act on them by mistake.
 * Pneuma's Visual Tools (and the Combat Tools' own styles) dress up the combat cards through the class names
 * pneuma-…. To get that look on the NET cards as well, every cprnet-… class (and the section marker) of a NET card
 * also gets its pneuma-… twin – only in the chat log, only for this module's cards, also for parts added later. */
const MODULE = "cpr-net-architecture";

function twin(el) {
    if (!(el instanceof Element)) return;
    const add = [];
    // only classes that are missing: classList.add() always rewrites the attribute, which would wake the observer
    // again and again
    for (const c of el.classList) if (c.startsWith("cprnet-") && !el.classList.contains("pneuma-" + c.slice(7))) add.push("pneuma-" + c.slice(7));
    if (add.length) el.classList.add(...add);
    const section = el.getAttribute?.("data-cprnet-section");
    if (section && el.getAttribute("data-pneuma-section") !== section) el.setAttribute("data-pneuma-section", section);
}
function twinTree(root) {
    twin(root);
    root.querySelectorAll?.('[class*="cprnet-"], [data-cprnet-section]').forEach(twin);
}
const watched = new WeakSet();
export function registerLook() {
    Hooks.on("renderChatMessage", (message, html) => {
        const root = html?.[0] ?? html;
        if (!root || !message?.flags?.[MODULE]) return;
        twinTree(root);
        if (watched.has(root)) return;
        watched.add(root);
        // buttons, rolls and results are added after the first render
        new MutationObserver(records => {
            for (const r of records) {
                if (r.type === "attributes") twin(r.target);
                else r.addedNodes.forEach(n => twinTree(n));
            }
        }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-cprnet-section"] });
    });
}
