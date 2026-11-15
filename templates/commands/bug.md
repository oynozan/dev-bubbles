---
description: Investigate a bug while marking suspects live on the Dev Bubbles map
argument-hint: "<bug description>"
---

The user reports this bug: $ARGUMENTS

If no description was given, ask for one first. Then load the dev-bubbles skill (or read `.claude/skills/dev-bubbles/SKILL.md`) and follow its **Bug procedure** and the `bugs.json` rules. In short:

1. Read `.dev-bubbles/components.json`, or run `dev-bubbles summary .`.
2. Before reading any code, add the bug to `.dev-bubbles/bugs.json` (next id like `b1`, `b2`, `"status": "open"`) with `suspected` marks on the likely components, each with a short reason.
3. Investigate. Narrow the marks as evidence comes in and remove suspects you rule out.
4. When you find the root cause, set the deepest matching component or file to `confirmed`.
5. After the fix, set `"status": "fixed"`.
6. After every edit, set `updatedAt` to the current ISO timestamp and run `dev-bubbles validate .`.

The user watches the map update live: striped red is suspected, solid red is confirmed.
