---
description: Investigate a bug while marking suspects live on the Dev Bubbles map
argument-hint: "<bug description>"
---

The user reports this bug: $ARGUMENTS

If no description was given, ask for one first. Then load the dev-bubbles skill (or read `.claude/skills/dev-bubbles/SKILL.md`) and follow its **Bug procedure**. Record every step with the bug commands, never by editing `.dev/bugs.json` by hand. In short:

1. Run `{{cli}} bug list` and reuse an open bug that matches. Otherwise run `{{cli}} bug open "<symptom in the user's words>"`, which prints the new id.
2. Read `.dev/components.json`, or run `{{cli}} summary`. Before reading any code, mark each likely component with `{{cli}} bug mark <id> <component> suspected "<why>"`.
3. Investigate. Narrow the marks as evidence comes in: mark deeper components or files (repo paths such as `src/auth/session.ts`) suspected, and drop ruled-out suspects with `{{cli}} bug clear <id> <target>`.
4. When you find the root cause, mark the deepest matching component or file with `{{cli}} bug mark <id> <target> confirmed "<root cause>"`.
5. After the fix, run `{{cli}} bug fix <id>`.

The user watches the map update live: striped red is suspected, solid red is confirmed.
