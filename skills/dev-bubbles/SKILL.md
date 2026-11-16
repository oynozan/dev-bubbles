---
name: dev-bubbles
description: Set up and keep current Dev Bubbles, a live bubble map of a git repo with agent-named components and live bug marks. Load on any request to set up, install or open it ("set up dev bubbles", "install dev bubbles", "show the code map"), when mapping code into components or adding, moving or deleting features, and on ANY report of something broken or wrong in a repo that has .dev/components.json, however casual ("this doesn't work", "X is broken", "why does Y fail"), before investigating.
---

# Dev Bubbles

Dev Bubbles is a local web app that draws a git repo as live nested bubbles. Every bubble is a component you define in `.dev/components.json` and shows the label you gave it, never a file or folder name. Components hold sub-components, leaf components hold files, and bubbles are sized by lines of code. Files are not bubbles: clicking a bubble opens a details window that lists its files with their imports, importers and HTTP calls. Solid lines are imports, dashed lines are HTTP calls. You also mark the code involved in a bug with the `bug` commands, which write `.dev/bugs.json`. The server watches the files, the git index and HEAD, and both JSON files, so every file change, commit, component edit and bug mark shows up in the user's browser within half a second. Dev Bubbles never calls an LLM and needs no API key.

In this skill, `dev-bubbles` means `node .dev/dev-bubbles/dist/bin/cli.js` run from the project root, or the `dev-bubbles` command if it is on the PATH.

## Setup procedure

Run this when the user asks to set up Dev Bubbles, or when `.dev/dev-bubbles/` is missing and no `dev-bubbles` command is on the PATH. It needs Node.js 22.12 or newer and git, and runs from the root of the project's git repo.

1. `git clone https://github.com/oynozan/dev-bubbles.git .dev/dev-bubbles`. If the clone already exists, run `git -C .dev/dev-bubbles pull` instead.
2. `npm install --prefix .dev/dev-bubbles`. This also builds `dist/` and takes about a minute.
3. `node .dev/dev-bubbles/dist/bin/cli.js init .`
4. `node .dev/dev-bubbles/dist/bin/cli.js up --open`
5. Run the map procedure.
6. Tell the user the map URL, and that from now on bug reports, file changes, commits and design changes show up there live, with the server starting by itself in each Claude Code session.

## CLI

`[repo]` defaults to the current directory, so pass nothing or `.` from the project root. The `bug` commands take no `[repo]` and act on the repo you run them in.

- `dev-bubbles serve [repo] [--port <n>]`: serve the live map in the foreground. The default port is 4747; when it is busy and no `--port` was given, the server takes a free port. It writes `.dev/server.json` while it runs.
- `dev-bubbles up [repo] [--open]`: start the map server in the background unless one already runs for this repo, and print its URL. `--open` also opens the browser. Logs go to `.dev/server.log`.
- `dev-bubbles down [repo]`: stop the background server.
- `dev-bubbles init [repo]`: create `.dev/components.json` and `.dev/bugs.json` if missing, add the gitignore entries from the table below, copy the `/map` and `/bug` commands to `.claude/commands/` and this skill to `.claude/skills/dev-bubbles/`, write a Dev Bubbles section into `CLAUDE.md` between `<!-- dev-bubbles:start -->` and `<!-- dev-bubbles:end -->`, and merge the three hooks into `.claude/settings.json`. Safe to re-run.
- `dev-bubbles summary [repo]`: compact text made for you. Directory tree with file counts and LOC, top cross-directory import counts, current components with their file counts, components that have both own files and sub-components, unmapped files, and unmatched HTTP calls.
- `dev-bubbles validate [repo]`: check both JSON files and print each error with its JSON path, plus components that match no file and files that match no component. Prints OK and exits 0 when clean, exits 1 otherwise.
- `dev-bubbles bug open <title...>`: add an open bug and print its new id, such as `b3`.
- `dev-bubbles bug mark <id> <target> <suspected|confirmed> [reason...]`: mark a component id from `components.json` or a repo file path. Marking a target again changes its state and reason. A target that is neither is refused, with the closest component ids.
- `dev-bubbles bug clear <id> <target>`: remove the mark on a target.
- `dev-bubbles bug fix <id>`: set the bug to fixed.
- `dev-bubbles bug list`: print the open bugs with their marks.
- `dev-bubbles hook <session|prompt|stop>`: run by the Claude Code hooks, never by hand.
- `--tracked-only`: map git-tracked files only. By default the file set is `git ls-files --cached --others --exclude-standard`, so new untracked files show up right away and gitignored files never do.

Every `bug` command validates, sets `updatedAt` and writes `bugs.json` atomically, and the open map follows within half a second.

The hooks that `init` installs in `.claude/settings.json`:

- SessionStart starts the map server if it is not running and gives you the map URL and the standing rules.
- UserPromptSubmit reminds you to record the bug when the user's message reads like a problem report.
- Stop blocks the end of your turn, once per turn, while the map is out of date: files that match no component, components with no files, invalid JSON or bad marks.

## The .dev/ folder

| Path | Written by | Git |
| --- | --- | --- |
| `dev-bubbles/` | the setup procedure, a clone of Dev Bubbles | gitignored |
| `components.json` | you | committed |
| `bugs.json` | you, through the `bug` commands | gitignored |
| `layout.json` | the UI, when the user drags a bubble | gitignored, never edit it |
| `server.json` | the running map server, its pid and URL | gitignored |
| `server.log` | the background server that `up` starts | gitignored |

- Write each JSON file as complete, valid JSON with 4-space indentation, like the examples below.
- Every object is strict: an unknown key is an error.
- A bad file never crashes the server. The map keeps the last valid version and shows the error in a banner until you fix it.

### components.json

```json
{
    "version": 1,
    "ignore": ["**/pnpm-lock.yaml", "**/*.snap", "**/*.generated.ts"],
    "components": [
        {
            "id": "storefront",
            "label": "Storefront",
            "include": ["apps/storefront/**"],
            "children": [
                { "id": "storefront.checkout", "label": "Checkout", "include": ["apps/storefront/src/checkout/**"] },
                { "id": "storefront.catalog", "label": "Product Catalog", "include": ["apps/storefront/src/products/**", "apps/storefront/src/search/**"] },
                { "id": "storefront.shell", "label": "Storefront Shell", "include": ["apps/storefront/**"] }
            ]
        },
        {
            "id": "billing",
            "label": "Billing Service",
            "include": ["packages/billing/**"],
            "children": [
                { "id": "billing.api", "label": "Billing API", "include": ["packages/billing/src/routes/**"] },
                {
                    "id": "billing.providers",
                    "label": "Payment Providers",
                    "include": ["packages/billing/src/providers/**"],
                    "children": [
                        { "id": "billing.providers.stripe", "label": "Stripe Connector", "include": ["packages/billing/src/providers/stripe/**"] },
                        { "id": "billing.providers.paypal", "label": "PayPal Connector", "include": ["packages/billing/src/providers/paypal/**"] },
                        { "id": "billing.providers.registry", "label": "Provider Registry", "include": ["packages/billing/src/providers/*"] }
                    ]
                },
                { "id": "billing.invoices", "label": "Invoicing", "include": ["packages/billing/**"] }
            ]
        },
        { "id": "notifications", "label": "Notifications", "include": ["packages/notifications/**", "packages/email-templates/**"] },
        { "id": "ui", "label": "Design System", "include": ["packages/ui/**"] },
        { "id": "tooling", "label": "Build Tooling", "include": ["package.json", "pnpm-workspace.yaml", "turbo.json"] }
    ],
    "httpEdges": [
        { "from": "storefront.checkout", "to": "billing.api", "note": "calls BILLING_API_URL from env" }
    ]
}
```

- `version` is always `1`.
- `id`: letters, digits, `_` and `-`, joined by dots, unique in the file. A child's id is its parent's id plus one segment (`billing.providers.stripe` under `billing.providers`). `unmapped` is reserved.
- Ids are stable. Never rename or reuse an existing id, because bug marks and pinned positions are keyed by it. Change the `label` instead.
- `label`: the name the user sees, one to three words in title case that say what the code does for the product ("Google Connector", "Billing API", "Payment Providers"). Never a raw folder or file name: `packages/ui` becomes Design System, `lib` becomes Shared Utilities. A folder that already names a feature, such as `checkout`, simply becomes Checkout.
- `include` (required) and `exclude` (optional): micromatch globs relative to the repo root, with forward slashes. `packages/ui/**` is everything under `packages/ui`. One component may span several folders, like `notifications` above. Use `exclude` to leave files to another component, for example `"exclude": ["apps/storefront/src/api-client.ts"]`.
- A file belongs to the deepest component whose globs match it. At equal depth the first in document order wins. So a parent can include its whole folder and its children take their subfolders. To leave the rest to a named leaf rather than the parent, end the children with a catch-all such as `storefront.shell` (the parent's folder, listed last) or a glob for the loose files such as `billing.providers.registry` (`providers/*`).
- `children` nest components, at most 4 levels in total.
- Files that match no component land in an `Unmapped` bubble. Aim for none.
- `ignore` (optional): globs for files to drop from the map entirely, such as lockfiles, generated code, committed build output and snapshots. Never ignore real source.
- `httpEdges` (optional): manual dashed edges between component ids, for HTTP calls the detector cannot see. The detector already links `fetch` and `axios` calls whose URL is a literal path starting with `/` to Express, Fastify, Hono and Next.js routes. Add an edge only for a call that `summary` lists as unmatched (base URL from env, another service, a generated client) when you can tell which component handles it. `note` says what the call is.

### How the map shows components

- Every bubble is a component and shows its label. The top level of the map is your top-level components, with no bubble for the repo around them, and no bubble ever shows a file or folder name.
- Files are not bubbles. A leaf component holds its files, and clicking a bubble opens a details window that lists its files with their imports, importers, HTTP calls and bug marks.
- So choose leaf components small enough to mean something: a feature or module you could name in conversation (Google Connector, Invoice PDFs, Session Store), roughly a handful to a few dozen files. Split a bigger area into children, 2 to 8 per parent.
- Avoid a component that has both its own files and sub-components. Its own files then show as an extra leaf with the parent's name beside its children. Give them a child of their own, and check `dev-bubbles summary`, which lists every component that still has both.
- Without components the map shows the bare directory tree with no names and asks the user to run `/map`.

### bugs.json

The `bug` commands write this file for you. Its format:

```json
{
    "version": 1,
    "bugs": [
        {
            "id": "b1",
            "title": "Invoice emails go out without a total",
            "status": "fixed",
            "marks": [
                { "file": "packages/email-templates/src/invoice.tsx", "state": "confirmed", "reason": "read the total from a renamed field" }
            ],
            "updatedAt": "2026-11-09T16:20:00Z"
        },
        {
            "id": "b2",
            "title": "Checkout charges the card twice",
            "status": "open",
            "marks": [
                { "component": "billing.providers.stripe", "state": "confirmed", "reason": "retries the charge without an idempotency key" },
                { "file": "apps/storefront/src/checkout/submit.ts", "state": "suspected", "reason": "may submit the form twice" }
            ],
            "updatedAt": "2026-11-11T10:00:00Z"
        }
    ]
}
```

- `id`: `b1`, `b2` and so on, one more than the highest existing number. Never reuse an id.
- `title`: one line describing the symptom, in the user's words.
- `status`: `open` or `fixed`. Fixed bugs stay in the file but are not drawn.
- `marks`: each mark has exactly one of `component` (an id from components.json) or `file` (a repo-relative path with forward slashes, as `git ls-files` prints it), a `state` of `suspected` or `confirmed`, and a short `reason`.
- A mark on an unknown component id or file path is skipped and reported in the banner.
- `updatedAt`: ISO 8601 timestamp such as `2026-11-11T10:00:00Z`, the time of the last edit.
- On the map, suspected is striped red and confirmed is solid red. A file mark shows on the bubble that holds the file and next to the file in its details window. A mark hidden inside a closed bubble gives that bubble a red ring and a count badge.

### layout.json

```json
{ "version": 1, "pins": { "billing.providers": [120, -40], "billing.providers.stripe": [10, 5] } }
```

Pinned positions in parent-local coordinates, keyed by node id: a component id, or `dir:<path>` before the repo is mapped. The UI owns this file, so read it if useful but never write it.

## Bug procedure

Follow this whenever a message from the user reports something broken or behaving wrong in a repo that has `.dev/components.json`, however casual ("this part doesn't work", "the export is broken", "why does login fail") and even in the middle of another task. No `/bug` is needed. The user watches the investigation live: striped red bubbles are suspects, solid red is the confirmed cause. Each step is one command that shows up on the map at once, so run them as you go, never all at the end.

1. Run `dev-bubbles bug list`. If an open bug already describes this symptom, keep working on its id instead of opening a new one.
2. Run `dev-bubbles bug open "<symptom in the user's words>"` and note the id it prints.
3. Before reading any code, pick the likely components from `.dev/components.json` (or `dev-bubbles summary .`) and run `dev-bubbles bug mark <id> <component> suspected "<reason>"` for each. Tell the user the suspects are now striped red on the map.
4. While you investigate, narrow the marks: mark the sub-component or file that holds the problem, add suspects you discover, and run `dev-bubbles bug clear <id> <target>` for each suspect you rule out.
5. When you find the root cause, run `dev-bubbles bug mark <id> <target> confirmed "<cause>"` on the deepest matching component or the exact file, and clear the suspects that turned out uninvolved.
6. After the fix is in and verified, run `dev-bubbles bug fix <id>`. Leave the marks as they are.

- Touch only the bug you are working on. Other open bugs keep their marks.
- When there are no components yet, mark files instead.
- Editing `.dev/bugs.json` by hand still works, following the format above, but the commands are preferred. After a hand edit, set `updatedAt` and run `dev-bubbles validate .`.

## Map procedure

1. If Dev Bubbles is not installed, run the setup procedure instead, which comes back here. If only `.dev/components.json` is missing, run `dev-bubbles init .`.
2. Run `dev-bubbles summary .`. Read the tree, the cross-directory imports and the unmatched HTTP calls.
3. Open entry points (package.json scripts, server or app bootstrap, route registration, top-level pages) and other key files only where a folder's purpose is unclear. Do not read every file.
4. Write `.dev/components.json` following the rules above:
   - Group by what the code does in the product (Auth, Billing API, Web App), not by file type.
   - Make every bubble a meaningful unit, as described in "How the map shows components": leaves of roughly a handful to a few dozen files, no component with both own files and sub-components, at most 4 levels.
   - Labels say what the code does, never a raw folder or file name.
   - Dot-path ids under the parent.
   - Cover every source file, root config files included. Put lockfiles and generated noise in `ignore`.
   - Add `httpEdges` for the unmatched HTTP calls you can attribute.
5. Run `dev-bubbles validate .`. Fix every error, cover every unmapped file, and fix or drop components that match no file. Repeat until it prints OK.
6. Run `dev-bubbles summary .` again. For every component it lists with both sub-components and own files, move those files into a child, then validate again.
7. Tell the user the top-level components in a few lines. An open map renames its bubbles live and keeps their positions.

When `components.json` already has components:

- Keep every existing id exactly, even when you move a component under a new parent. A stable id beats the dot-path convention.
- Add components, regroup, relabel and adjust globs as needed.
- Delete a component only when its code was deleted from the repo.

## Keep the map current

Whenever you add, move or delete files or features, update `.dev/components.json` in the same turn: a new component for a new feature, or wider globs on an existing one. Then run `dev-bubbles validate .`. The Stop hook blocks the end of your turn while files are unmapped. Never rename ids.
