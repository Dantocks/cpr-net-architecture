/** Shared presentation for Combat Tools chat controls only. Native roll links stay untouched. */
const controls = [
    "[data-net-button]"
].join(",");
const observed = new WeakSet();
const cardRoots = '.cprnet-net-card,.cprnet-combat-message,.cprnet-manual-card,.cprnet-aoe-card,.cprnet-instant-card,.cprnet-emp-card,.cprnet-grapple-card,.cprnet-quickhack-card,.cprnet-status-cleanup-card';
const icons = { evade: 'fa-person-running', damage: 'fa-droplet', apply: 'fa-bolt', injury: 'fa-heart-crack', roll: 'fa-dice', resist: 'fa-shield-halved', retry: 'fa-wrench', release: 'fa-wrench', cancel: 'fa-xmark', choose: 'fa-list-check' };
const clicked = new WeakSet();
const disabled = (node) => node.matches(":disabled,[aria-disabled=\"true\"]");
function decorate(node) {
    node.classList.add("cprnet-chat-button");
    // Saved chat cards may still contain the old visible Reset label.
    if (node.dataset.aoeAction === "reset" && !node.closest(".cprnet-effect-gm-controls") && (node.textContent?.trim() || !node.querySelector(".fa-rotate-left"))) {
        const icon = document.createElement("i");
        icon.className = "fas fa-rotate-left";
        icon.setAttribute("aria-hidden", "true");
        node.replaceChildren(icon);
    }
    const text = node.textContent?.trim() ?? "", action = node.dataset.chatAction ?? node.dataset.sceneEffectAction ?? node.dataset.trapAction ?? node.dataset.aoeAction ?? node.dataset.instantAction ?? node.dataset.quickhackAction ?? "";
    const gmOnly = !!node.dataset.trapAction || !!node.dataset.sceneEffectAction && action !== "avoid" || node.dataset.gmOnly === "true"
        || !!node.dataset.aoeAction && ["show", "removeSmoke", "scatter", "hit", "miss", "exclude", "forcehit", "add", "reset", "damageReset", "damageResolved", "effectsResolved"].includes(action)
        || !!node.dataset.instantAction && ["skip", "reset", "review"].includes(action);
    node.dataset.chatRole = gmOnly ? "gm" : "player";
    const iconOnly = !text || node.classList.contains("cprnet-damage-status-slot");
    node.classList.toggle("cprnet-chat-icon", iconOnly);
    const recovery = ["reset", "damageReset", "damageResolved", "effectsResolved", "review", "forcehit", "exclude", "skip", "retry", "release"].includes(action)
        || node.closest(".cprnet-damage-recovery-controls");
    const cancel = node.classList.contains("cprnet-cancel-exchange") || action === "cancel" || action === "removeSmoke";
    node.dataset.chatKind = node.matches(".cprnet-half-armor, .cprnet-interact-armor, .cprnet-ablate-armor") ? "toggle" : cancel ? "cancel" : recovery ? "recovery" : "action";
    if (!iconOnly && node.dataset.chatKind !== "toggle" && !node.querySelector("i,img,svg")) {
        const icon = document.createElement("i");
        icon.setAttribute("aria-hidden", "true");
        const inferred = node.matches('.cprnet-evasion-override') ? 'evade' : node.matches('.cprnet-result-damage') ? 'damage'
            : node.matches('.cprnet-apply-damage,[data-ribs-apply]') ? 'apply' : node.matches('.cprnet-apply-critical') ? 'injury'
                : node.matches('[data-emp-select]') ? 'choose' : node.closest('.cprnet-group-action') ? 'roll' : undefined;
        const name = node.dataset.chatIcon ?? (cancel ? 'fa-xmark' : recovery ? 'fa-wrench' : node.dataset.instantAction === 'roll' ? 'fa-shield-halved' : icons[action] ?? icons[inferred ?? ''] ?? 'fa-arrow-right');
        icon.className = "fas " + name + " cprnet-chat-action-icon";
        node.prepend(icon);
    }
    const busy = clicked.has(node) && disabled(node);
    node.classList.toggle("cprnet-chat-busy", busy);
    if (busy)
        node.setAttribute("aria-busy", "true");
    else {
        node.removeAttribute("aria-busy");
        clicked.delete(node);
    }
    const completed = !busy && disabled(node) && (node.matches('.cprnet-apply-damage[data-cprnet-damage-target="recorded"]')
        || node.dataset.chatState === "applied");
    node.classList.toggle("cprnet-chat-complete", completed);
    if (completed && iconOnly) {
        node.title = "Applied";
        node.setAttribute("aria-label", "Applied");
    }
    if (!node.title && node.getAttribute("aria-label"))
        node.title = node.getAttribute("aria-label");
}
export function styleChatButtons(root, moduleCard = false) {
    if (!moduleCard && !root.matches(cardRoots) && !root.querySelector(cardRoots + ',' + controls))
        return;
    for (const node of Array.from(root.querySelectorAll(controls)))
        decorate(node);
    if (observed.has(root))
        return;
    observed.add(root);
    // Inspect changed controls/subtrees only; native dice expansion needs no full-card pass.
    const observer = new MutationObserver(records => {
        observer.disconnect();
        const changed = new Set();
        const collect = (node) => {
            const element = node instanceof Element ? node : node.parentElement;
            const button = element?.closest(controls);
            if (button && root.contains(button))
                changed.add(button);
            if (element)
                for (const child of Array.from(element.querySelectorAll(controls)))
                    changed.add(child);
        };
        for (const record of records) {
            if (record.type === 'childList') {
                for (const node of Array.from(record.addedNodes))
                    collect(node);
                const button = record.target.closest?.(controls);
                if (button)
                    changed.add(button);
            }
            else
                collect(record.target);
        }
        for (const node of changed)
            if (root.contains(node))
                decorate(node);
        watch();
    });
    const watch = () => observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled", "aria-disabled", "aria-pressed", "title", "data-gm-only", "data-chat-state", "data-chat-action"] });
    root.addEventListener("click", event => {
        const node = event.target.closest(controls);
        if (node && !disabled(node)) {
            clicked.add(node);
            setTimeout(() => { observer.disconnect(); decorate(node); watch(); }, 0);
        }
    }, true);
    watch();
}
export function registerChatButtons() {
    Hooks.on("renderChatMessage", (message, html) => {
        if (html[0])
            styleChatButtons(html[0], !!foundry.utils.getProperty(message, 'flags.cpr-net-architecture'));
    });
}
