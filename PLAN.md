# PLAN.md — Live codebase bubble map

Dev Bubbles (`dev-bubbles`). Fork of `githubocto/repo-visualizer` (MIT), turned into a lightweight local React app.

The slug `dev-bubbles` is used for the CLI and the package name. Everything Dev Bubbles owns in a target repo lives in `.dev/`, with the clone of Dev Bubbles itself in `.dev/dev-bubbles/`.

## Rules for Claude Code

- Work one phase at a time. End each phase with tests green, `tsc --noEmit` clean and a manual check against the fixture. Then stop and summarize. Don't start the next phase without approval.
- Only use the dependencies listed under **Stack**. Ask before adding anything else.
- Comments only for non-obvious lines, section splits, or file headers.
- Keep the original MIT `LICENSE` notice.
- Never let a bad JSON file crash the server. Keep the last valid state and surface the error.

## Goal

A local dashboard that shows a git repo as live, nested bubbles (components → sub-components, with the files held by the leaf components). Every bubble is a component named by the agent, and there is no outer bubble for the repo itself. Clicking a bubble opens a draggable details window with its files and their connections. Solid lines are imports, dashed lines are HTTP calls. The user's coding agent groups and labels components with human-readable names. When the user reports a bug, the agent marks the components that could be involved: **striped red** means suspected, **solid red** means confirmed.

## Non-goals (v1)

- Multiple repos or cross-repo services. A monorepo with several services is in scope.
- Languages other than JS/TS. Keep an analyzer interface so more can be added later.
- Runtime tracing, hosting, auth, multiple users.
- The tool calling an LLM API itself. The coding agent does the labeling.

## Key decisions

1. **One local Node process.** `dev-bubbles serve [repo]` scans and watches the repo, runs analysis, and serves the React app plus an event stream. `dev-bubbles up` starts the same server in the background, at most one per repo, and `down` stops it. Bind to `127.0.0.1` only.
2. **Files are the source of truth**, in `<repo>/.dev/`:
   - `components.json`: written by the agent; commit it.
   - `bugs.json`: written by the agent through `dev-bubbles bug`; gitignored.
   - `layout.json`: pinned positions written by the UI; gitignored.
   - `server.json` and `server.log`: pid, URL and log of the running server; gitignored.
   - `dev-bubbles/`: the clone of Dev Bubbles; gitignored.

   The server watches the JSON files like any other file. Edits show up live.
3. **AI labels come from the coding agent** through the dev-bubbles skill and slash commands, so no API key is needed. The map shows only the names the agent writes, never file or folder names. When there's no manifest yet, fall back to the directory tree drawn without names, with a hint to run `/map`.
4. **File set:** `git ls-files --cached --others --exclude-standard`. That's tracked files plus untracked files that aren't gitignored, so files the agent just created appear before they're committed. Add a `--tracked-only` flag for strict mode.
5. **Transport:** Server-Sent Events from server to client (full snapshot, debounced). Plain `POST` from client to server for layout pins. No WebSocket. The client reconnects on its own when the server restarts.
6. **Rendering:** SVG. React renders the node structure. d3-force writes positions straight to DOM refs on each tick; never call `setState` per tick. Target is up to about 3k files.
7. **Commit history:** the snapshot lists the last 100 commits. Picking one in the list at the bottom left shows the map at that commit, grouped and named by the current `components.json`, so the names stay the same across history.
8. **One-step install:** `npx skills add oynozan/dev-bubbles`, then the user asks the agent to set up Dev Bubbles. The skill has the agent clone Dev Bubbles into `.dev/dev-bubbles/`, build it, run `init` and `up --open`, and map the repo. Claude Code hooks then start the server in every session, push the agent to record bug reports on the map, and keep it from ending a turn while the map is out of date.

## Stack

- Runtime: `react` + `react-dom` (19), `d3` (v7, already in the fork), `micromatch` (already in the fork), `chokidar` (v4), `zod`, `oxc-parser`, `oxc-resolver`.
- Dev: `vite`, `@vitejs/plugin-react`, `typescript`, `tsx`, `vitest`, `concurrently`.
- Remove: `@actions/*`, `esbuild`, `husky`, `jest`, `ts-jest`, `@types/jest`, and `lodash` if it ends up unused.
- Check the `oxc-parser` and `oxc-resolver` APIs when installing. If either doesn't fit, propose `@swc/core` plus a small resolver that honors tsconfig `paths`, and ask before switching.

## Target layout

```
bin/
  cli.ts                    serve (default) | up | down | init | summary | validate | bug | hook
  background.ts             up and down, .dev/server.json, opening the browser
  init.ts                   .dev files, gitignore, templates, CLAUDE.md section, hooks in .claude/settings.json
  bugs.ts                   bug open | mark | clear | fix | list
  hooks.ts                  the session, prompt and stop hooks
  repo.ts                   repo loading, the map checks shared by validate and the stop hook, the CLI path
server/
  index.ts                  static app, GET /api/events (SSE), POST /api/layout
  inventory.ts              git ls-files, set diff, LOC per file
  watcher.ts                chokidar + debounce → rescan
  analyzers/
    types.ts                Analyzer interface
    js-ts.ts                import extraction + resolution
    http.ts                 route + client call detection
  components.ts             manifest load/validate, file → component assignment, fallback tree
  edges.ts                  file-level edges (import, http, manual)
  bugs.ts                   bugs.json load/validate
  snapshot.ts               builds the Snapshot sent to the client
  history.ts                git log, the last 100 commits
shared/
  schema.ts                 zod schemas + TS types (manifest, bugs, layout, snapshot)
web/
  index.html  main.tsx  App.tsx
  map/
    BubbleMap.tsx           svg root, zoom, layers (bubbles below, edges above)
    Bubble.tsx              one node as <g>, drag
    layout.ts               pack + per-group force sims, containment, pins
    edges.ts                visible-level aggregation, path geometry
    EdgeLayer.tsx           edge paths and arrow markers above the bubbles
    LabelLayer.tsx          names and bug count badges above the edges, nested like the bubbles
    marks.ts                bug marks per node, roll-up into closed groups, fit to marks
    patterns.tsx            stripe pattern defs
    CircleText.tsx          from the original
  panels/
    BugPanel.tsx  Breadcrumb.tsx  ErrorBanner.tsx  Legend.tsx
    DetailsWindow.tsx       draggable window with a bubble's files, connections and marks
    CommitList.tsx          commit list at the bottom left and the past-commit banner
  lib/
    utils.ts                from the original (truncateString, keepBetween, keepCircleInsideCircle, …)
    time.ts                 relative ages for bugs and commits
templates/
  claude-snippet.md         written into the target repo's CLAUDE.md by init
  commands/map.md           /map slash command
  commands/bug.md           /bug slash command
skills/dev-bubbles/SKILL.md the agent skill: setup, formats, bug and map procedures
fixtures/sample-app/        small app used by tests and manual checks
scripts/make-fixture.ts     copies the fixture to a temp dir and makes it its own git repo
scripts/demo-bug.ts         plays a scripted bug through bugs.json (npm run demo:bug)
```

## Data contracts (`shared/schema.ts`)

### Node ids

- Component: its manifest `id` (dot path, e.g. `auth.oauth.google`)
- Own files of a component that also has sub-components: `own:<id>`, an extra leaf with the parent's label
- Fallback directory node: `dir:<path>`
- File: `file:<path>`, for edge ends and bug marks only, since files are not bubbles

### `components.json`

```json
{
  "version": 1,
  "ignore": ["**/*.lock", "**/package-lock.json"],
  "components": [
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
            { "id": "auth.oauth.apple",  "label": "Apple Connector",  "include": ["src/auth/oauth/apple/**"] }
          ]
        }
      ]
    },
    { "id": "lib", "label": "Shared Utilities", "include": ["src/lib/**"] }
  ],
  "httpEdges": [
    { "from": "web", "to": "api.billing", "note": "calls BILLING_URL from env" }
  ]
}
```

Rules:
- `id` must be unique and stable. The agent may change labels but must keep ids, so bug marks and pins survive.
- `label` is short and human-readable and says what the code does. It is the only name the map shows, so it is never a raw folder or file name (`lib` becomes `Shared Utilities`).
- `include` / optional `exclude` are micromatch globs relative to the repo root. A group can span several folders.
- A file belongs to the **deepest** component whose globs match it. If two match at the same depth, the first in document order wins.
- Leaf components hold the files. Avoid a component with both own files and sub-components: its own files then show as an extra leaf with its label, and `summary` lists it. In the example above, a file such as `src/auth/session.ts` would do that to Auth, so it needs a child of its own.
- Files that match no component go into one `Unmapped` leaf.
- `httpEdges` are manual dashed edges between component ids, for calls the detector can't see.

### `bugs.json`

```json
{
  "version": 1,
  "bugs": [
    {
      "id": "b1",
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

Rules:
- Each mark targets exactly one of `component` or `file`.
- `state` is `suspected` or `confirmed`.
- `status` is `open` or `fixed`. Fixed bugs stay in the file but aren't drawn.

### `layout.json`

```json
{ "version": 1, "pins": { "auth.oauth": [120, -40], "auth.oauth.google": [10, 5] } }
```

Pins are in parent-local coordinates.

### Snapshot (server → client)

```ts
type Snapshot = {
  root: TreeNode                                   // components or dirs, leaves carry files { path, loc } for sizing and the details window
  edges: { from: string; to: string; kind: 'import' | 'http'; label?: string }[]  // node ids
  bugs: Bug[]                                      // open only
  pins: Record<string, [number, number]>
  errors: string[]                                 // validation errors for the banner
  generatedAt: string
  commits: { sha: string; subject: string; author: string; date: string }[]  // last 100, newest first, empty on a past commit
  commit?: string                                  // set when the snapshot shows a past commit
}
```

## Phases

### Phase 0: Clean the fork

- Delete everything that belongs to the GitHub Action: `action.yml`, the built `index.js`, `src/index.jsx`, `jest.config.cjs`, `.husky/`, and the deps listed under **Stack → Remove**.
- Scaffold `web/` (Vite + React + TS), `server/`, `shared/`, `bin/`. Scripts:
  - `dev`: server + Vite via `concurrently`, with Vite proxying `/api`
  - `build`, `start`, `test`, `typecheck`
- Build `fixtures/sample-app/`: `src/auth/session.ts`, `src/auth/oauth/{google,apple}/*.ts`, `src/lib/*.ts`, `src/api/routes/*.ts` (Express-style routes), and `web/src/*.tsx` calling `fetch('/api/...')`. Use a tsconfig with one `paths` alias.
- `scripts/make-fixture.ts`: copies the fixture to a temp dir, runs `git init && git add -A && git commit`, and prints the path.
- Port the rendering from `src/Tree.tsx` into `web/map/` as a **static** view, fed by a temporary `GET /api/snapshot` that builds a directory tree on the server. Move `CircleText.tsx`, `utils.ts` and `language-colors.json` over.
- **Done when:** the browser shows the same circle pack the Action used to produce, for the fixture repo.

### Phase 1: Live inventory

- `inventory.ts`:
  - Find the repo root with `git rev-parse --show-toplevel`, then run `git ls-files --cached --others --exclude-standard -z`.
  - Count LOC per file. Skip binaries (null byte in the first 8 KB) and files over 1 MB. Apply the manifest `ignore` globs.
- `watcher.ts`:
  - Run chokidar on the repo root, using an `ignored` function for `.git/`, `node_modules`, `dist`, `build`, `.next`. Also watch the git index and HEAD, so `git add`, commits and resets update the file set and the commit list.
  - On any event, debounce 300 ms, re-run `ls-files`, diff the sets, and re-read only added or changed files (by mtime + size).
- `GET /api/events` (SSE): sends a full snapshot on connect and after each rescan. Remove the temporary `/api/snapshot`.
- **Done when:**
  - Creating, growing or deleting a file updates the browser in under 1 s.
  - Gitignored files never appear.
  - `--tracked-only` hides untracked files.

### Phase 2: Interactive map

- `layout.ts`:
  - Sizes and initial positions: `d3.hierarchy(...).sum(loc)` + `d3.pack()`.
  - Each node is a `<g transform="translate(x,y)">` nested inside its parent's `<g>`. Positions are parent-local, so moving a parent moves its whole subtree.
  - Run one force simulation per *open* sibling group. Reuse the forces from `reflowSiblings` in the old `Tree.tsx` (center pull, `forceCollide(r + padding)`) and add a containment force built on `keepCircleInsideCircle`. The top-level group also gets a viewport center force.
  - Simulations write to DOM refs on tick. React re-renders only when a new snapshot arrives.
  - When a new snapshot arrives:
    - Keep existing positions.
    - Place new nodes near their parent's center.
    - Reheat only the groups that changed, with low alpha.
    - Never reshuffle the whole map.
  - Switching to another commit is the exception: the map packs afresh and the view fits it whole, since old spots can wedge resized bubbles into each other.
- Zoom/pan with `d3-zoom` on the svg root. Clicking a group zooms to fit it, with an animated transition. The breadcrumb goes back up.
- The repo draws no circle, so top-level bubbles float free and the view fits the smallest circle around them.
- Semantic zoom: a component shows its children only when its on-screen radius is above ~60 px. Otherwise it's drawn closed with its label.
- Drag with `d3-drag` per node:
  - Dragging pins the node (`fx`/`fy`) and saves the pin with `POST /api/layout` → `layout.json`.
  - Double-click unpins.
  - The containment force clamps pins that end up outside a resized parent.
- Labels:
  - Only components (the `Unmapped` leaf included) draw a label: curved `CircleText` when open, centered text when closed. There is no root bubble, the top level shows the components.
  - Files are not bubbles. Fallback directories draw no label, their path shows in the hover tooltip.
- Details window: clicking a bubble opens a draggable window that lists its files with their imports, importers and HTTP calls, and the bug marks on them.
  - When the snapshot has no components yet, show a hint to run `/map` in the coding agent.
  - Replace the old rule that hides labels longer than `r * 0.5` (`Tree.tsx` line ~267). Show every name in full: wrap onto up to three lines, and spill past a circle too small for it. Names sit in their own layer above the bubbles and edges, so no neighbor paints over them. Only a bubble that is a dot on screen drops its name to the hover tooltip. Labels stay between 11 px and 32 px on screen.
- Colors:
  - Dark theme only, page and map background `#1a1a1a`.
  - No file-type colors. Groups get a neutral dark fill shaded by depth, leaves a flat neutral a bit lighter than their group.
  - Color is reserved for status: bug marks and the ring on closed ancestors (Phase 6).
- **Done when:**
  - Zoom and drag are smooth on this repo and on a ~2k-file repo.
  - Dragging a component carries its children.
  - Pins survive a page reload and file changes.

### Phase 3: Components manifest and AI labels

- `components.ts`: load `components.json` and validate it with zod, apply the assignment rules above, and fall back to the directory tree when the file is missing. Validation errors go to `snapshot.errors` and show in `ErrorBanner`; the last valid manifest stays in use.
- CLI `init [repo]`, safe to re-run:
  - Create `.dev/components.json` and `.dev/bugs.json` if missing.
  - Gitignore `.dev/dev-bubbles/`, `bugs.json`, `layout.json`, `server.json` and `server.log`.
  - Copy `templates/commands/*.md` to `<repo>/.claude/commands/` and the skill to `<repo>/.claude/skills/dev-bubbles/`.
  - Write `claude-snippet.md` into the repo's CLAUDE.md between `<!-- dev-bubbles:start -->` and `<!-- dev-bubbles:end -->`.
  - Merge the hooks from Phase 7 into `<repo>/.claude/settings.json`.
- CLI `summary <repo>`: compact text for the agent. Shows:
  - the directory tree with file counts and LOC
  - the top cross-directory import counts (once Phase 4 exists)
  - the current components with their file counts
  - components with both own files and sub-components
  - unmapped files
  - unmatched HTTP calls (once Phase 5 exists)
- CLI `validate <repo>`: validates both JSON files and prints each error with its JSON path. Also reports components that match no files and files that match no component. Exits 1 on any error.
- `templates/commands/map.md` tells the agent to:
  1. Run `dev-bubbles summary`.
  2. Open entry points and key files only as needed.
  3. Write `components.json`:
     - at most 4 levels deep
     - short human-readable labels that say what the code does, never raw folder or file names
     - every bubble a meaningful named unit, leaves of roughly a handful to a few dozen files
     - no component with both own files and sub-components
     - existing ids never renamed
     - every source file covered
  4. Run `dev-bubbles validate` until it's clean.
- **Done when:** running `/map` in Claude Code on the fixture produces Auth → OAuth → Google Connector / Apple Connector, and the map relabels live without losing positions.

### Phase 4: Import edges (solid)

- `analyzers/types.ts`: an `Analyzer` interface with `match(path)` and `analyze(path, source)`, returning raw import specifiers, routes and HTTP calls. Only `js-ts.ts` is implemented now.
- `js-ts.ts`:
  - Parse `.ts .tsx .js .jsx .mjs .cjs` with `oxc-parser`.
  - Collect static imports, re-exports, `import()` with a string literal, and `require()` with a string literal.
  - Resolve with `oxc-resolver`, honoring tsconfig `paths`/`baseUrl` and workspace package `exports`.
  - Drop unresolvable specifiers and anything in `node_modules`.
- Cache analysis per file by mtime + size; re-analyze only changed files.
- `web/map/edges.ts`:
  - Map both ends of each file edge to their deepest **visible** ancestor (visible = drawn at the current zoom).
  - Drop self-edges and merge duplicates. The count sets stroke width.
  - Draw a neutral light gray solid line with an arrowhead and a slight curve. Edges are never colored by language.
  - Hovering a bubble highlights its incoming and outgoing edges and dims the rest.
- **Done when:**
  - Tests cover alias resolution, re-exports and dynamic imports on the fixture.
  - Edges re-aggregate correctly as you zoom in and out.

### Phase 5: HTTP edges (dashed)

- `http.ts` is heuristic and conservative.
  - Routes:
    - Express/Fastify/Hono style: `app.get('/path', …)`, `router.post(…)`
    - Next.js: `app/**/route.ts` and `pages/api/**`
  - Calls: `fetch`, `axios(...)`, `axios.<method>(...)`, when the URL is a string literal or a template literal whose static prefix starts with `/`.
  - Matching: calls match routes by method + path pattern, with `:id`, `[id]` and `${…}` treated as wildcards. Each match makes an edge from the caller file to the route handler file, with kind `http` and label `METHOD /path`.
- Manual `httpEdges` from `components.json` are drawn the same way.
- Style: neutral light gray dashed line; the tooltip shows the method and path.
- **Done when:**
  - The fixture's `fetch('/api/login')` draws a dashed edge to the login route.
  - Unmatched calls appear in `summary`, so the agent can add manual edges.

### Phase 6: Bug marks

- `bugs.ts`: load `bugs.json` and validate it. Marks pointing at an unknown component id or file path are skipped and reported in the banner.
- `patterns.tsx`:
  - **suspected:** diagonal red stripes over the base fill (SVG `<pattern>`, `patternTransform="rotate(45)"`) with a red stroke.
  - **confirmed:** solid red fill with a thicker red stroke.
  - Keep the stripe width readable at every zoom level (counter-scale by the zoom factor `k`).
- When a marked node is hidden inside a closed ancestor, that ancestor gets a red ring and a count badge, so marks stay visible when zoomed out.
- `BugPanel`:
  - Lists open bugs.
  - Clicking a bug zooms to fit its marks and shows each mark's `reason`.
  - With several open bugs, all marks are shown; selecting one dims the others.
- `scripts/demo-bug.ts` (`npm run demo:bug -- [repo]`) tests the flow without an agent. It writes a demo bug in steps 4 s apart (three suspected components, one component and one file, the file confirmed, fixed) and then removes it, keeping other bugs.
- `templates/commands/bug.md`, `templates/claude-snippet.md` and the skill tell the agent, whenever the user reports a problem, even casually, to:
  1. Run `dev-bubbles bug list` to avoid a duplicate.
  2. `bug open` the symptom in the user's words.
  3. `bug mark` the likely components `suspected` before digging into code.
  4. Narrow the marks as evidence comes in, and `bug clear` suspects that get ruled out.
  5. When the root cause is found, `bug mark` the deepest matching component or file `confirmed`.
  6. After the fix, `bug fix`.
- **Done when:**
  - Hand-editing `bugs.json` updates the map within 1 s.
  - Running `/bug <description>` on the fixture first shows striped suspects, then a solid red bubble as the agent narrows it down.

### Phase 7: One-step install and agent integration

- The skill's setup procedure, run from the target repo's root:
  1. `git clone https://github.com/oynozan/dev-bubbles.git .dev/dev-bubbles`, or `git -C .dev/dev-bubbles pull` when the clone exists.
  2. `npm install --prefix .dev/dev-bubbles`, which also builds `dist/`.
  3. `node .dev/dev-bubbles/dist/bin/cli.js init .`
  4. `node .dev/dev-bubbles/dist/bin/cli.js up --open`
  5. The map procedure.
- CLI server commands:
  - `serve [repo] [--port n]`: port 4747 by default, a free port when it is busy and no `--port` was given. Writes `.dev/server.json` while running.
  - `up [repo] [--open]`: start the server in the background unless one already runs for this repo, and print its URL. Logs go to `.dev/server.log`.
  - `down [repo]`: stop it.
- CLI bug commands, so the agent records each step with one call. Each validates, sets `updatedAt` and writes `bugs.json` atomically:
  - `bug open <title...>` prints the new id.
  - `bug mark <id> <target> <suspected|confirmed> [reason...]`, where the target is a component id or a repo file path.
  - `bug clear <id> <target>`, `bug fix <id>` and `bug list`.
- `hook <session|prompt|stop>`, which `init` installs as Claude Code hooks:
  - SessionStart: start the server if it is not running and give the agent the map URL and the standing rules (record bug reports at once, keep `components.json` current, offer to map a repo with no components).
  - UserPromptSubmit: when the message reads like a problem report ("doesn't work", "broken", "error", "wrong"), remind the agent to record the bug before investigating, with the exact commands.
  - Stop: when the map is out of date (unmapped files, components with no files, invalid JSON, bad marks), block the end of the turn until the agent updates `.dev/components.json` or `.dev/bugs.json`, at most once per turn.
- The commit list gains new commits as they are made.
- **Done when:**
  - In a fresh project, `npx skills add oynozan/dev-bubbles` and "set up dev bubbles" end with the mapped repo open in the browser.
  - A new Claude Code session starts the server by itself.
  - A casual "this doesn't work" shows striped suspects before the agent reads code.
  - A new commit appears in the commit list without a reload.

## Testing

- Use vitest unit tests for:
  - component assignment (deepest match, tie order, `exclude`, `ignore`)
  - the fallback tree
  - import resolution
  - HTTP matching
  - edge aggregation
  - schema validation for all three JSON files
- Integration tests run on a temp copy of the fixture made by `scripts/make-fixture.ts`.
- End every phase with tests green, `tsc --noEmit` clean and a manual check in the browser against the fixture.
