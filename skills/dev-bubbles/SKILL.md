---
name: dev-bubbles
description: Map a codebase into labeled components and track bug investigations on the Dev Bubbles live bubble map. Load when mapping or grouping a codebase into components, labeling components, editing .dev-bubbles/components.json or .dev-bubbles/bugs.json, or whenever the user reports a bug in a repo that has a .dev-bubbles/ folder.
---

# Dev Bubbles

Dev Bubbles is a local web app that draws a git repo as live nested bubbles: components hold sub-components, which hold files, sized by lines of code. Solid lines are imports, dashed lines are HTTP calls. You, the coding agent, decide the components and their labels in `.dev-bubbles/components.json`, and you mark the code involved in a bug in `.dev-bubbles/bugs.json`. The server watches both files, so every save shows up in the user's browser within a second. Dev Bubbles never calls an LLM and needs no API key.

## Install and run

Needs Node.js 22.12 or newer and git.

```sh
npm install -g dev-bubbles   # or prefix every command below with npx
dev-bubbles init .           # once per repo, from the repo root
dev-bubbles                  # serve the map at http://127.0.0.1:4747
```

The server listens on 127.0.0.1 only and runs until stopped, so start it in the background or ask the user to run it in their own terminal. Edits to the JSON files never need a restart.

## CLI

Pass `.` as `<repo>` when you run from the repo root.

- `dev-bubbles [serve] [--repo <path>] [--port <n>]`: serve the live map. Defaults are the current directory and port 4747.
- `dev-bubbles init <repo>`: create `.dev-bubbles/` with an empty `components.json` and `bugs.json`, add `bugs.json` and `layout.json` to `.gitignore`, copy the `/map` and `/bug` commands to `.claude/commands/` and this skill to `.claude/skills/dev-bubbles/`, and print the path of a snippet for the user to paste into CLAUDE.md.
- `dev-bubbles summary <repo>`: compact text made for you. Directory tree with file counts and LOC, top cross-directory import counts, current components with their file counts, unmapped files, and unmatched HTTP calls.
- `dev-bubbles validate <repo>`: check both JSON files and print each error with its JSON path, plus components that match no file and files that match no component. Prints OK and exits 0 when clean, exits 1 otherwise.
- `--tracked-only`: map git-tracked files only. By default the file set is `git ls-files --cached --others --exclude-standard`, so new untracked files show up right away and gitignored files never do.

## The .dev-bubbles/ folder

| File | Written by | Git |
| --- | --- | --- |
| `components.json` | you | committed |
| `bugs.json` | you | gitignored |
| `layout.json` | the UI, when the user drags a bubble | gitignored, never edit it |

- Write each file as complete, valid JSON with 2-space indentation.
- Every object is strict: an unknown key is an error.
- A bad file never crashes the server. The map keeps the last valid version and shows the error in a banner until you fix it.

### components.json

```json
{
  "version": 1,
  "ignore": ["**/package-lock.json", "**/*.lock", "**/*.generated.ts"],
  "components": [
    { "id": "web", "label": "Web App", "include": ["web/**"] },
    {
      "id": "api",
      "label": "API Server",
      "include": ["src/api/**", "src/config/**"],
      "children": [
        { "id": "api.routes", "label": "Routes", "include": ["src/api/routes/**"] }
      ]
    },
    {
      "id": "auth",
      "label": "Auth",
      "include": ["src/auth/**"],
      "children": [
        {
          "id": "auth.oauth",
          "label": "OAuth",
          "include": ["src/auth/oauth/**"],
          "children": [
            { "id": "auth.oauth.google", "label": "Google Connector", "include": ["src/auth/oauth/google/**"] },
            { "id": "auth.oauth.apple", "label": "Apple Connector", "include": ["src/auth/oauth/apple/**"] }
          ]
        }
      ]
    },
    { "id": "lib", "label": "lib", "include": ["src/lib/**"] },
    { "id": "tooling", "label": "Tooling", "include": ["package.json", "tsconfig.json", ".gitignore"] }
  ],
  "httpEdges": [
    { "from": "web", "to": "api.routes", "note": "calls API_URL from env" }
  ]
}
```

- `version` is always `1`.
- `id`: letters, digits, `_` and `-`, joined by dots, unique in the file. A child's id is its parent's id plus one segment (`auth.oauth.google` under `auth.oauth`). `unmapped` is reserved.
- Ids are stable. Never rename or reuse an existing id, because bug marks and pinned positions are keyed by it. Change the `label` instead.
- `label`: short and human-readable, one to three words ("Google Connector"). Folder names that are already clear stay as they are: `lib` stays `lib`.
- `include` (required) and `exclude` (optional): micromatch globs relative to the repo root, with forward slashes. `src/auth/**` is everything under `src/auth`. One component may span several folders, like `api` above. Use `exclude` to leave files to another component, for example `"exclude": ["web/src/api-client.ts"]`.
- A file belongs to the deepest component whose globs match it. At equal depth the first in document order wins. So a parent can include its whole folder, its children take their subfolders, and loose files such as `src/auth/session.ts` stay in the parent.
- `children` nest components, at most 4 levels in total.
- Files that match no component land in an `Unmapped` bubble, grouped by folder. Aim for none.
- `ignore` (optional): globs for files to drop from the map entirely, such as lockfiles, generated code, committed build output and snapshots. Never ignore real source.
- `httpEdges` (optional): manual dashed edges between component ids, for HTTP calls the detector cannot see. The detector already links `fetch` and `axios` calls whose URL is a literal path starting with `/` to Express, Fastify, Hono and Next.js routes. Add an edge only for a call that `summary` lists as unmatched (base URL from env, another service, a generated client) when you can tell which component handles it. `note` says what the call is.

### bugs.json

```json
{
  "version": 1,
  "bugs": [
    {
      "id": "b1",
      "title": "Billing page shows no invoices",
      "status": "fixed",
      "marks": [
        { "file": "src/api/routes/billing.ts", "state": "confirmed", "reason": "compared the account id with the wrong session field" }
      ],
      "updatedAt": "2026-11-09T16:20:00Z"
    },
    {
      "id": "b2",
      "title": "Google login redirects to /undefined",
      "status": "open",
      "marks": [
        { "component": "auth.oauth.google", "state": "confirmed", "reason": "callback URL built from missing env var" },
        { "file": "src/lib/url.ts", "state": "suspected", "reason": "shared redirect helper" }
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
- `updatedAt`: ISO 8601 timestamp such as `2026-11-11T10:00:00Z`. Set it to the current time on every edit.
- On the map, suspected is striped red and confirmed is solid red. A marked node hidden inside a closed bubble gives that bubble a red ring and a count badge.

### layout.json

```json
{ "version": 1, "pins": { "auth.oauth": [120, -40], "file:src/lib/url.ts": [10, 5] } }
```

Pinned positions in parent-local coordinates, keyed by node id: a component id, `dir:<path>` or `file:<path>`. The UI owns this file, so read it if useful but never write it.

## Map procedure

1. If `.dev-bubbles/` is missing, run `dev-bubbles init .`.
2. Run `dev-bubbles summary .`. Read the tree, the cross-directory imports and the unmatched HTTP calls.
3. Open entry points (package.json scripts, server or app bootstrap, route registration, top-level pages) and other key files only where a folder's purpose is unclear. Do not read every file.
4. Write `.dev-bubbles/components.json` following the rules above:
   - Group by what the code does in the product (Auth, Billing, Web App), not by file type.
   - At most 4 levels. Split a folder only when its parts are distinct concepts, and prefer 2 to 8 children per parent.
   - Short human-readable labels. Clear folder names stay as they are.
   - Dot-path ids under the parent.
   - Cover every source file, root config files included. Put lockfiles and generated noise in `ignore`.
   - Add `httpEdges` for the unmatched HTTP calls you can attribute.
5. Run `dev-bubbles validate .`. Fix every error, cover every unmapped file, and fix or drop components that match no file. Repeat until it prints OK.
6. Tell the user the top-level components in a few lines. An open map relabels live and keeps its positions.

When `components.json` already has components:

- Keep every existing id exactly, even when you move a component under a new parent. A stable id beats the dot-path convention.
- Add components, regroup, relabel and adjust globs as needed.
- Delete a component only when its code was deleted from the repo.

When you later add a folder or feature, update `components.json` in the same change and run validate.

## Bug procedure

Follow this whenever the user reports a bug in a repo that has `.dev-bubbles/`, even when they do not mention the map. The user watches the investigation live: striped red bubbles are suspects, solid red is the confirmed cause.

1. Read `.dev-bubbles/components.json`, or run `dev-bubbles summary .`, and pick the likely components from the description alone.
2. Before reading any code, add the bug to `.dev-bubbles/bugs.json`: the next free id, `"status": "open"`, `suspected` marks on those components with a short reason each, and `updatedAt`. If the file is missing, start from `{ "version": 1, "bugs": [] }`. Tell the user the suspects are now striped red on the map.
3. Investigate. As evidence comes in, narrow the marks: replace a broad component with the sub-component or file that holds the problem, add suspects you discover, and remove suspects you ruled out.
4. When you find the root cause, set the deepest matching component, or the exact file, to `confirmed` with the cause as its reason. Remove suspects that turned out uninvolved.
5. After the fix is in and verified, set `"status": "fixed"` and leave the marks as they are.
6. After every edit, set `updatedAt` and run `dev-bubbles validate .`. Fix any error before you continue.

- Touch only the bug you are working on. Other open bugs keep their marks.
- When there are no components yet, mark files instead.
