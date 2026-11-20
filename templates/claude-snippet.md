## Dev Bubbles

The user watches a live bubble map of this repo in the browser. `{{cli}} up` prints its URL and starts it when it is not running.

- Record every problem report the moment it comes in, however casual ("this part doesn't work"), before you investigate. The user watches the marks live:
    1. `{{cli}} bug open "<symptom in the user's words>"` prints the bug id (`bug list` shows the open ones, so reuse a match)
    2. `{{cli}} bug mark <id> <component> suspected "<why>"` for each likely component
    3. Narrow the marks as you investigate, `{{cli}} bug clear <id> <target>` drops a ruled-out suspect
    4. `{{cli}} bug mark <id> <component or file> confirmed "<root cause>"`
    5. `{{cli}} bug fix <id>` after the fix
- When you add, move or delete files or features, update `.dev/components.json` in the same turn and run `{{cli}} validate`. The Stop hook enforces this.
- Keep `edges` in `.dev/components.json` current too. The map only detects JavaScript and TypeScript imports and `fetch` or `axios` calls to literal paths. Every other connection between components (other languages, API clients, IPC, events) is a line only once you add it, and `{{cli}} summary` lists the code it cannot read.
- Never rename a component id.
- Load the dev-bubbles skill for the file formats and the map procedure.
