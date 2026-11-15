---
description: Group this repo into labeled components on the Dev Bubbles map
argument-hint: "[optional focus, e.g. split the API by service]"
---

Map this repository into components for Dev Bubbles. Load the dev-bubbles skill (or read `.claude/skills/dev-bubbles/SKILL.md`) and follow its **Map procedure** and the `components.json` rules. In short:

1. Run `dev-bubbles summary .` (use `npx dev-bubbles` if it is not installed).
2. Open entry points and key files only as needed.
3. Write `.dev-bubbles/components.json`: at most 4 levels, short human-readable labels, clear folder names kept as they are, dot-path ids under the parent, every source file covered, `ignore` for lockfiles and generated noise, `httpEdges` for the unmatched HTTP calls from the summary. If components already exist, keep every existing id and only add, regroup or relabel.
4. Run `dev-bubbles validate .` and fix what it reports until it prints OK.

Extra instructions from the user, if any: $ARGUMENTS
