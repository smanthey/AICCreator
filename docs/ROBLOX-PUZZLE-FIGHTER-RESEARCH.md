# Super Puzzle Fighter II Turbo — Game Mechanics Research

Reference for the Roblox Puzzle Brawl clone. Use this so implementation and audits **get the mechanics right**. Super Puzzle Fighter is hyper-addicting for specific reasons; the clone should preserve them.

---

## Why it’s hyper-addicting

1. **Clear cause–effect** — Every clear sends counter gems to the opponent. No ambiguity; you feel your hits.
2. **Versus tension** — You see incoming garbage and a countdown; defense (cancel with your own clears) and drop-alley pressure create constant back-and-forth.
3. **Chain/cascade satisfaction** — One crash gem can set off long chains; big power-gem + chain moments are high-dopamine and skill-expressive.
4. **Skill ceiling** — Linking gems, building power gems, and setting chains are learnable but deep; matches stay interesting.
5. **Comeback potential** — Defense mechanic (cancel incoming with sends) and the fact that one big chain can flip the game keep sessions from feeling hopeless.
6. **Short rounds, clear win condition** — Block the opponent’s drop alley; rounds are fast, so “one more game” is easy.

The Roblox clone should preserve: **versus pressure**, **chain/crash/power-gem clarity**, **defense (cancel incoming)**, **drop-alley as win condition**, and **tight controls (rotate, move, soft-drop)**.

---

## Core mechanics (canonical)

### Playfield

- **Grid:** 6 columns × 12 rows (visible play area). Gems fall and stack.
- **Drop alley:** One column (often middle, e.g. 4th) where new gem pairs spawn. If the drop alley is **blocked**, the player loses the round. Keeping it clear is the primary survival goal.

### Gem types

| Type | Role |
|------|------|
| **Normal gems** | Red, green, blue, yellow. Destroyed when a **crash gem** of the same color touches them (or they’re part of a chain). |
| **Crash gems** | Same four colors. Destroy **all adjacent/connected same-color gems** when they land or are triggered. Key to chains. |
| **Power gems** | Formed when same-color gems form a **rectangle** (min 2×2). When destroyed, send **more** counter gems than single gems. Bigger rectangle = more damage. |
| **Counter gems (garbage)** | Sent to the opponent when you clear gems. Show a **number** (e.g. 5); it decreases by 1 for each **gem pair** the opponent places. At 0 they turn into normal colored gems. Can be cleared early with a crash of the right color. |
| **Rainbow gems** | Diamond-shaped. Destroy **all gems of one chosen color** in the field. Appear every 25th pair (or similar). Can be saved for a “tech bonus” if dropped without using. |

### Chain reactions

- When a gem is destroyed, others may **fall** onto crash gems or same-color groups and trigger further clears = **chain**.
- Classic setup: same-color gems stacked so that when one group is cleared, the next group falls onto a crash gem and clears, etc.
- **More chains = more counter gems** sent; chains are the main skill differentiator.

### Counter gems (sending and receiving)

- **Sending:** Clearing gems (especially in chains, with power gems) adds counter gems to a **pending queue** for the opponent. Count and pattern matter.
- **Receiving:** Pending counter gems don’t fall until the receiver **places their current pair**. Indicator shows count (e.g. 1–10 = Caution, 11–30 = Warning, 31+ = Danger).
- **Defense:** While you have pending counter gems, **sending** counter gems to the opponent **cancels** incoming: e.g. every 2 you send cancels 1 incoming. So you can “dig out” by clearing a lot before the pending drops.

### Attack patterns

- Each character (or side) can have a **drop pattern**: how pending counter gems are **distributed** on the opponent’s grid (which columns get how many). Different patterns make defense harder or easier. Strong clones vary patterns per character/skin.

### Controls (must feel tight)

- **Move** left/right.
- **Rotate** left/right (clear mapping; no accidental wrong rotation).
- **Soft-drop** (hold down to fall faster).
- Optional: hard-drop. No need for hold/reserve in the classic formula.

### Win condition

- **Block the opponent’s drop alley** (fill the spawn column so a new pair cannot appear). First to block loses; the other wins the round.

---

## Design targets for the Roblox clone

Use these when implementing or auditing:

1. **Grid and drop alley** — 6×12 (or equivalent); one dedicated drop column; loss = drop alley blocked.
2. **Four gem colors + crash + power + counter + rainbow** — Same roles as above; counter gems have a countdown and can be cleared early.
3. **Chains** — Clearing causes falls that can trigger more clears; chain length increases damage sent.
4. **Power gems** — 2×2 or larger same-color rectangles multiply damage when cleared (and in chains).
5. **Defense** — Pending counter gems visible; sending clears cancel incoming; tension and comeback feel preserved.
6. **Attack patterns** — Configurable or per-character drop patterns for counter gems.
7. **Input latency** — Move/rotate/soft-drop must feel instant (sub-frame or low ms); no input buffering that kills “one more block” moments.
8. **RNG** — Gem pair RNG should feel fair (no obvious streaks); optional bias controls for testing.
9. **Session length** — Short rounds; best-of-3 or best-of-5; easy “rematch” or “one more.”

---

## Monetization research (fits the game)

The clone is **skill-based versus**: winner is decided by play, not by spending. Monetization must **never** change win conditions, chain damage, or drop-alley rules. What fits:

### Principles that fit puzzle versus

1. **No pay-to-win** — No purchasable power: no “pay for stronger chains,” “pay for less garbage,” or “pay for more time.” Match outcome = skill only. Protects both addiction (fair “one more game”) and trust.
2. **Cosmetic-first** — Skins, board themes, gem skins, character avatars, victory/defeat effects, drop-alley visuals. Visible to opponent and self; no effect on grid, RNG, or damage.
3. **Optional and fair** — Purchases feel optional. No designed frustration (e.g. “pay to skip” only if the base loop is already fun without paying). Transparent pricing; no hidden spend pressure.
4. **Retention-aligned** — Reward **playing**: quests, wins, sessions, streaks unlock cosmetics or progress. Pay can = more cosmetics or battle-pass tier, not gameplay advantage.
5. **Short rounds = many sessions** — Many games per hour → many chances to show off cosmetics and many natural moments for “one more” and optional spend (e.g. new board after a win).

### What to implement (Roblox + puzzle versus)

| Layer | What | Fits because |
|-------|------|--------------|
| **Game passes** (one-time) | Permanent cosmetic: e.g. “Pro board pack,” “Character skin set,” “VIP title + gem skin.” | No recurring pressure; players who pay keep it forever; no effect on versus balance. |
| **Developer products** (repeat) | One-off purchases: e.g. “100 premium currency,” “seasonal board,” “emote pack.” | Optional; cosmetic or convenience (e.g. currency for cosmetic shop), not power. |
| **Battle pass / season pass** | Time-limited track: play to progress; optional paid tier for extra cosmetics. | Drives sessions and “one more game”; rewards play; paid tier = more cosmetics, not power. Keep FOMO mild (no punishing non-spenders in match). |
| **Earned currency + shop** | Play → soft currency → unlock cosmetics in shop. Paid currency for premium shop or faster unlock. | Play is primary path; pay = shortcut to cosmetics only. |
| **Starter packs** | Bundles for new players (e.g. first board + title). | Low barrier; cosmetic; good for onboarding. |

### What to avoid

- **Pay for power** — Any purchase that changes damage, chain math, garbage sent, or drop-alley behavior.
- **Pay to skip core loop** — If “skip” is the main product, the loop is wrong; fix the loop, don’t monetize frustration.
- **Heavy FOMO / dark patterns** — No fake scarcity (“only 10 left”), no hidden totals, no competitive pressure that punishes non-payers in the match itself.
- **Loot boxes for power** — Cosmetic gacha is already sensitive; any randomness that affects match outcome is out.

### Roblox-specific

- **Game passes:** Create in Monetization; grant permanent access in Lua (e.g. board skin, character). Price for value; offer low/mid/high tiers.
- **Developer products:** Consumable (e.g. currency) or one-time unlocks; fire `MarketplaceService:PromptProductPurchase` and grant on callback.
- **Price optimization:** Roblox supports A/B price tests; use once you have enough volume (~60k+ transactions/30 days) to learn.
- **Trust:** Monetization feels optional and fair; purchases blend into the experience (e.g. “equip board” in lobby), no pop-ups mid-match.

### Metrics that fit

- **ARPDAU** (average revenue per DAU) — Healthy if revenue comes from optional cosmetics and passes, not from pay-to-win.
- **Conversion** — % of players who ever pay; focus on clear value (e.g. “this board looks great”) not pressure.
- **Retention** — D1/D7; monetization should support retention (battle pass, quests, cosmetics to show off), not hurt it.

---

## References

- StrategyWiki: [Super Puzzle Fighter II Turbo / Gameplay](https://strategywiki.org/wiki/Super_Puzzle_Fighter_II_Turbo/Gameplay)
- StrategyWiki: [Advanced Techniques](https://strategywiki.org/wiki/Super_Puzzle_Fighter_II_Turbo/Advanced_Techniques)
- Wikipedia: [Super Puzzle Fighter II Turbo](https://en.wikipedia.org/wiki/Super_Puzzle_Fighter_II_Turbo)

---

## Use in the pipeline

- **site_audit** and **opencode_controller** objectives can reference “per ROBLOX-PUZZLE-FIGHTER-RESEARCH.md” when auditing or implementing **core loop, combo, chain, versus mechanics, and monetization**.
- Mechanics: keep doc in sync when tuning (e.g. cancel ratio, rainbow interval, grid size) so the clone stays aligned with what makes the original addictive.
- Monetization: use the principles and tables above so live-ops and growth work add **ethical, cosmetic-only** monetization that fits the game (game passes, battle pass, earned + paid currency, no pay-to-win).
