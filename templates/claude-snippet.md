## Dev Bubbles

This repo uses Dev Bubbles, a live bubble map of the code served by `dev-bubbles` at http://127.0.0.1:4747. You keep it up to date through `.dev-bubbles/components.json` (named components, committed) and `.dev-bubbles/bugs.json` (bug marks, gitignored). The dev-bubbles skill holds the formats and procedures.

- Whenever the user reports a bug, follow the bug procedure (or `/bug`) before and during the investigation: add the bug with suspected marks first, narrow them as you go, confirm the root cause, set it to fixed after the fix.
- To map or remap the code into components, use `/map` or the map procedure. The map shows only your component labels, never file or folder names, so name every area by what it does. Never rename an existing component id.
- When you add a folder or feature, update `components.json` in the same change.
- Write both files with 4-space indentation and run `dev-bubbles validate .` after every edit.
