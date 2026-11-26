# NET Architecture (Cyberpunk RED) v1.5.12

Run Cyberpunk RED NET Architectures in **Foundry VTT V12** – Access Points, Jack In / Jack Out, a live NET window and all NET actions with chat cards.
Made with Claude.ai.

## ⚠️ You build the NET yourself
This module brings the **tools** to run a NET Architecture – **not the NET content**. Before you can use it:
1. **Create the NET scenes yourself** – one scene per NET Architecture.
2. **Move them into a scene folder named `Net`** – only scenes in that folder (or its subfolders) are recognised.
3. **Place the Black ICE and Demon tokens on those scenes yourself.** The Black ICE / Demon actors are **not part of this module** – create them yourself in the Actors tab first.
4. **Never place a Demon on Floor 1.**

<img width="999" height="398" alt="image" src="https://github.com/user-attachments/assets/e714d51a-8abd-4922-b1a8-4710084f0b01" />
<img width="1082" height="667" alt="image" src="https://github.com/user-attachments/assets/e3f24737-e17d-45ef-8dfe-ffab52d29ba3" />
<img width="305" height="950" alt="image" src="https://github.com/user-attachments/assets/afc79f83-ee11-4fff-b810-8cf4de2a908e" />
<img width="927" height="382" alt="image" src="https://github.com/user-attachments/assets/7777f9eb-6a8d-41f4-9463-42dfe08c267d" />
<img width="907" height="360" alt="image" src="https://github.com/user-attachments/assets/e341c9ab-f0f9-4054-8053-dd7644af3b23" />
<img width="513" height="369" alt="image" src="https://github.com/user-attachments/assets/4b6a92ff-72f5-4935-afc6-edb8b6378f5a" />
<img width="289" height="686" alt="image" src="https://github.com/user-attachments/assets/4c70e548-911d-484c-a67c-51a0286af279" />

## Features
- Turns any token into an **Access Point** – configure it, lock/release it for players
- **Jack In / Jack Out** from the token's right-click menu – your Netrunner stays selected
- **NET window** showing the architecture: floors, branches, passages, Black ICE and Demons
- Runners only see the floors they have already reached
- All **NET actions** with chat cards and the system's own dice (Dice So Nice works)
- **New controls:** left-click a token to make it active (Tab cycles), left-click a floor or use the arrow keys to move, right-click a token for the active token's actions against it – the GM can steer every Netrunner, Black ICE and Demon
- Attack Black ICE & Demons with **Zap, Sword or Banhammer**
- **Netrunner vs Netrunner:** Zap, Vrizzbolt, Hellbolt, Nervescrub, Poison Flatline, Superglue, DeckKRASH and attacks on the target's rezzed programs – Flak, Shield and Armor count automatically, every effect is applied by the GM on the chat card and can be undone in the Jack Out summary
- **Unsafe Jack Out** (DeckKRASH or from the menu, also while Superglued): a card lists every rezzed Black ICE the Netrunner met – the GM rolls and applies each effect, with Undo there and in the Jack Out summary
- **Unplug all Netrunners** (GM): every Netrunner jacks out with its Jack Out summary, other player tokens are removed – only Black ICE and Demons stay
- **Black ICE & Demons** fight back – damage, effects and status are applied automatically
- **NET Actions counter** in the Netrunner's window – counts Jack In (quiet: 2) and every NET Action the Netrunner uses, blocks further ones when used up during combat (GM can override), ▲ / ▼ to correct, back to 0 every new round
- **Going Quiet** and optional automatic **Lying in Wait**
- Link a journal with your NET rules for quick reference
- Live sync – GM and players see the same state

## Installation
**Recommended:** in Foundry's setup screen go to **Add-on Modules → Install Module** and paste this manifest URL:
```
https://github.com/Dantocks/cpr-net-architecture/releases/latest/download/module.json
```
**Manual:** download `cpr-net-architecture_v1.5.12.zip` from the latest release and unzip it into `Data/modules/cpr-net-architecture/`.

Then:
1. Restart Foundry if needed
2. Open your world, **Manage Modules** → enable **NET Architecture (Cyberpunk RED)**
3. Set up your NET scenes as described above
4. Right-click a token on your map → configure it as an Access Point and link it to a NET scene

Requires Foundry V12 and the Cyberpunk RED Core system. Works alongside Pneuma's Combat Tools and works best with Pneuma's Visual Tools.

## Unofficial content
NET Architecture is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.
