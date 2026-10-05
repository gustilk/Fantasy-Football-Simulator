---
name: Lineup intent
description: The user's chosen DraftKings contest format and weekly salary workflow.
---

The user wants a lineup section that maximizes projected DraftKings points without exceeding $50,000. They chose NFL Classic and weekly DraftKings salary CSV uploads.

**Why:** The user emphasized that player salaries change each week and selected Classic with CSV imports.

**How to apply:** Treat the imported contest file as the authority for salaries, eligible positions, and its specific game set. Do not assume the app's all-Sunday forecast group is a real DraftKings contest or silently carry salaries to another week. Highest projected points does not mean guaranteed winnings.

For direct Classic salary retrieval, the user wants the featured NFL Classic slate.

**Why:** The user specified, “We need the featured classic.”

**How to apply:** Verify the official featured Classic draft group and its game dates before retrieving its salary CSV. Do not substitute another Classic slate, Madden contests, Showdown, or the app's broader Sunday forecast group.

Salary imports must not depend on a forecast already existing. Forecast pairing is required for generation, not for uploading and retaining the contest CSV.

**Why:** The user reported that the lineup salary upload would not let them proceed and kept waiting; requiring a saved forecast blocked the independent salary-import step.

**How to apply:** Allow CSV-first workflows and explicitly confirm the matching forecast before generating. Retain successfully imported salaries while forecasts are prepared.

The user does not need Sunday night games in the DraftKings workflow because they are not part of their DraftKings Classic contest.

**Why:** The user said, “I don't need the Sunday night game because that's not part of Draftkings classic.”

**How to apply:** Exclude Sunday night from the DraftKings Sunday batch and displayed forecasts. Game Simulator has its own specific-game selection, including other game times. Preserve archived inputs and use the uploaded contest salary file as the authority for actual lineup eligibility.

Keep Game Simulator for other games and provide single-game DraftKings Captain/Showdown lineup creation inside that section. The normal Lineups tab remains NFL Classic.

**Why:** The user said, “Yes will keep game simulator for other games but I need Draftkings lineup in Game Simulator section,” then clarified, “The single game in game simulator is for Draftkings captain lineup.” They explicitly want Captain 1.5× points and kicker/defense scoring, including defensive TDs, sacks, fumbles, field goals and extra points.

**How to apply:** Select and simulate one specific matchup in Game Simulator, then use that saved forecast for Captain lineups. Do not send this flow to Sunday-only forecasts or impose Classic's two-game minimum. Use the official Showdown rules and contest CSV for CPT/FLEX IDs, salaries and eligibility. Preserve Classic independently.

Classic and Captain CSV uploads must be independent, including retention and forecast pairing.

**Why:** The user said, “I did not upload the captain mode CVs, the classic CVs and captain mode should be separate.”

**How to apply:** A Classic upload must not appear as the Captain upload. Uploading, replacing or removing either file must not overwrite or delete the other's file. Without a Captain CSV, explain that it must be uploaded rather than displaying the Classic file.

Salary uploads must be available across desktop and mobile browsers without uploading again.

**Why:** The user said desktop CSV uploads did not show on mobile and uploading twice was inconvenient.

**How to apply:** Keep contest salary data shared across devices while retaining Classic/Captain separation. Existing browser-only uploads must have a safe migration path; a stale browser must not restore a remotely deleted file.

Shared salary data does not automatically imply shared forecast pairing.

**Why:** Simulation archives remain device-specific; copying a desktop forecast reference to a fresh phone would link to a forecast that the phone cannot access.

**How to apply:** Preserve each device's pairing for unchanged contest data. Synchronizing forecast archives is a separate feature; until that exists, require a matching forecast on the current device rather than silently importing another device's forecast reference.