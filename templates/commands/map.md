---
description: Group this repo into named components on the Dev Bubbles map
argument-hint: "[optional focus, e.g. split the API by service]"
---

Map this repository into components for Dev Bubbles. Load the dev-bubbles skill (or read `.claude/skills/dev-bubbles/SKILL.md`) and follow its **Map procedure** and the `components.json` rules. In short:

1. Run `{{cli}} summary`.
2. Open entry points and key files only as needed.
3. Write `.dev/components.json` with 4-space indentation. Every bubble on the map is one of your components with its label, leaf components hold the files, and clicking a bubble lists its files and their connections. So:
   - name what the code does for the product (Google Connector, Billing API), never a raw folder or file name
   - make each leaf small enough to mean something, a feature or module of roughly a handful to a few dozen files, at most 4 levels
   - avoid a component with both own files and sub-components, since its own files show as an extra leaf with its name, and give those files a child of their own
   - dot-path ids under the parent, every source file covered, `ignore` for lockfiles and generated noise, `edges` for every connection the map cannot detect: imports in the code the summary says it cannot read, and the unmatched HTTP calls
   - if components already exist, keep every existing id and only add, regroup or relabel
4. Run `{{cli}} validate` and fix what it reports until it prints OK.
5. Run `{{cli}} summary` again and move the own files of every component it lists with both sub-components and own files into a child, then validate again.

Extra instructions from the user, if any: $ARGUMENTS
