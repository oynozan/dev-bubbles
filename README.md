# Dev Bubbles

Dev Bubbles draws a git repository as a live map of nested bubbles in your browser and lets your coding agent name them. The agent groups the code into components with human-readable names such as Billing API or Google Connector, the map shows the imports and HTTP calls between them, and when you report a bug the agent marks the suspects in red while it investigates, so you can watch the search narrow down to the cause. Everything runs on your machine with no API key: Dev Bubbles never calls an LLM, it reads the JSON files your agent writes and redraws as soon as they change.

## What you see

- A dark map of nested bubbles, one per component, sized by lines of code. The top level shows your top-level components, with no bubble around the whole repo.
- Names chosen by your coding agent. Every bubble shows the label the agent gave its component, never a file or folder name. Files are not bubbles: the innermost components hold them. Until the agent maps the repo, the bubbles follow the directory tree without names.
- A details window. Click a bubble to list its files with what each one imports, what imports it and the HTTP calls it makes, plus the bug marks on them. Drag the window anywhere on the screen.
- Solid lines for imports and dashed lines for HTTP calls, drawn between the bubbles you can see at the current zoom.
- Bug marks: striped red for suspected, solid red for confirmed. A mark on a file shows on the bubble that holds it. A mark hidden inside a closed bubble gives that bubble a red ring and a count badge.
- A bug panel that lists the open bugs and shows why each bubble was marked.
- A commit list at the bottom left. Pick any of the last 100 commits to see the map as the repo was then, grouped and named by the current `components.json`.
- Live updates. Creating, editing or deleting a file, or the agent saving its JSON files, updates the map within about a second.
- Zoom with the wheel and pan with the middle mouse button, go back up with the breadcrumb, drag a bubble to pin it in place and double-click to unpin.

Edges come from JavaScript and TypeScript code: static, dynamic and `require` imports resolved with tsconfig paths, and `fetch` or `axios` calls matched to Express, Fastify, Hono and Next.js routes. Files in other languages still show up in their components, without edges.

## Install

Requires Node.js 22.12 or newer and git. Install Dev Bubbles from a clone: `npm install` builds it and `npm link` puts `dev-bubbles` on your PATH.

```sh
git clone https://github.com/oynozan/dev-bubbles
cd dev-bubbles
npm install
npm link
```

To update, run `git pull` and `npm install` in the clone. A global install straight from GitHub (`npm install -g github:oynozan/dev-bubbles`) does not work, because npm leaves out the build tools when it prepares a git package for a global install.

To run it without installing, use `npx github:oynozan/dev-bubbles` wherever this README says `dev-bubbles`.

## Quick start

In the repository you want to map:

```sh
dev-bubbles init .
dev-bubbles
```

`init` creates `.dev-bubbles/`, gitignores its local files, copies the `/map` and `/bug` commands into `.claude/commands/` and the agent skill into `.claude/skills/dev-bubbles/`, and prints the path of a short snippet to paste into your `CLAUDE.md`, so the agent keeps the map up to date on its own. `dev-bubbles` then serves the map at http://127.0.0.1:4747 until you stop it.

Then, in Claude Code in the same repository:

1. Run `/map`. The agent reads `dev-bubbles summary`, writes `.dev-bubbles/components.json` and checks it with `dev-bubbles validate`. The open map switches to the new names as soon as the file is saved.
2. Report a bug with `/bug`, for example `/bug the Google login redirects to /undefined`. The agent first marks the likely components as suspected, narrows the marks while it reads the code, and marks the root cause as confirmed.
3. Watch the marks move on the map. Once the fix is in, the agent sets the bug to fixed and its marks disappear.

### The skill on its own

The procedures behind `/map` and `/bug` live in one agent skill, which works in any coding agent that supports skills. To install only the skill:

```sh
npx skills add oynozan/dev-bubbles
```

Then ask your agent to map the repo with Dev Bubbles, or just report a bug in a repo that has a `.dev-bubbles/` folder.

## Test the bug flow

The marks come from `.dev-bubbles/bugs.json`, so anything that writes that file moves them. Open the map first, then try one of these.

### With your agent

In Claude Code in the mapped repository, run `/bug` with a symptom, for example `/bug saving the profile shows a blank page`. The agent adds the bug with striped suspects before it reads any code, narrows them while it investigates, turns the cause solid red and sets the bug to fixed once the fix is in.

### Scripted demo

In a clone of Dev Bubbles, `npm run demo:bug` plays a made-up bug in about 4 seconds per step: three suspected components, then one of them and one of its files, then that file confirmed, then fixed, so the marks clear. At the end it removes the demo bug and leaves any other bugs alone.

```sh
npm run dev                        # terminal 1, the map of this repository at http://localhost:5173
npm run demo:bug                   # terminal 2
npm run demo:bug -- /path/to/repo  # or any repository that has a components.json
```

Without a path it uses `$DEV_BUBBLES_REPO`, then the clone itself.

### By hand

Edit `.dev-bubbles/bugs.json` and save. Put a component id from your `components.json` in place of `auth`:

```json
{
    "version": 1,
    "bugs": [
        {
            "id": "b1",
            "title": "Trying out the marks",
            "status": "open",
            "marks": [
                { "component": "auth", "state": "suspected", "reason": "just testing" }
            ]
        }
    ]
}
```

Then change `suspected` to `confirmed`, mark a `file` path instead, or set `status` to `fixed`, and the map follows every save. A mistake shows in the error banner, and `dev-bubbles validate .` prints it with its JSON path.

### Why it is real-time

Nothing polls. The server watches the repository with a file watcher. When `bugs.json` or any other file changes, it waits about 300 ms for further changes, rebuilds the snapshot and pushes it to every open map over Server-Sent Events. From saving `bugs.json` to the map changing takes about a third of a second.

## CLI

```
dev-bubbles [command] [repo] [options]
```

| Command | What it does |
| --- | --- |
| `serve` | Serve the live map. This is the default command. The URL prints right away and the map fills in once the first scan is done |
| `init` | Set up `.dev-bubbles/`, gitignore `bugs.json` and `layout.json`, and copy the `/map` and `/bug` commands and the agent skill into `.claude/` |
| `summary` | Print a compact overview for the agent: directories with file counts and lines of code, top cross-directory imports, components, components with both own files and sub-components, unmapped files and unmatched HTTP calls |
| `validate` | Check `components.json` and `bugs.json`, print each error with its JSON path, and exit 1 on any error |

| Option | Default | |
| --- | --- | --- |
| `--repo <path>` | `$DEV_BUBBLES_REPO`, then the current directory | Repository when `[repo]` is not given |
| `--port <n>` | `4747` | Port for `serve`, `0` picks a free one |
| `--tracked-only` | off | Leave out files git does not track (`serve`, `summary`, `validate`) |
| `-h`, `--help` | | Show the help |

Any folder inside a git repository works, Dev Bubbles always maps the whole repository. By default the map holds every file from `git ls-files --cached --others --exclude-standard`, so new files show up before they are committed and gitignored files never do. Binary files and files over 1 MB are left out. The server only listens on `127.0.0.1`.

## The .dev-bubbles/ folder

| File | Written by | Commit it |
| --- | --- | --- |
| `components.json` | the agent | yes |
| `bugs.json` | the agent | no, `init` gitignores it |
| `layout.json` | the map, when you drag a bubble | no, `init` gitignores it |

A components file looks like this:

```json
{
    "version": 1,
    "ignore": ["**/package-lock.json"],
    "components": [
        {
            "id": "auth",
            "label": "Auth",
            "include": ["src/auth/**"],
            "children": [
                { "id": "auth.google", "label": "Google Connector", "include": ["src/auth/oauth/google/**"] },
                { "id": "auth.apple", "label": "Apple Connector", "include": ["src/auth/oauth/apple/**"] },
                { "id": "auth.session", "label": "Session Store", "include": ["src/auth/**"] }
            ]
        },
        { "id": "billing", "label": "Billing API", "include": ["src/api/billing/**"] }
    ]
}
```

A file goes to the deepest component that matches it, and at equal depth to the first one listed. So Session Store, listed last with all of `src/auth/`, takes the Auth files the two connectors leave, and Auth keeps no files of its own. Own files next to sub-components would show as an extra bubble with the parent's name.

The [skill](skills/dev-bubbles/SKILL.md) describes both formats in full, and this repository maps itself in [.dev-bubbles/components.json](.dev-bubbles/components.json). A broken file never stops the server: the map keeps the last valid version and shows the error in a banner until it is fixed.

## Development

```sh
git clone https://github.com/oynozan/dev-bubbles
cd dev-bubbles
npm install          # also builds dist/
npm run dev          # server (tsx watch) on 127.0.0.1:4747 and the Vite dev server on http://localhost:5173
```

| Script | |
| --- | --- |
| `npm run dev` | Server and Vite with hot reload, open http://localhost:5173 |
| `npm test` | Run the vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Build the web app and the CLI into `dist/` |
| `npm start -- --repo <path>` | Run the built CLI |
| `npm run fixture` | Copy `fixtures/sample-app` into a temporary git repo and print its path |
| `npm run demo:bug -- [repo]` | Play a scripted bug in the repo's `bugs.json`, see [Test the bug flow](#test-the-bug-flow) |

`npm run dev` maps the Dev Bubbles repository itself. To map another repository, set `DEV_BUBBLES_REPO`:

```sh
DEV_BUBBLES_REPO=/path/to/repo npm run dev              # bash
$env:DEV_BUBBLES_REPO = "C:\path\to\repo"; npm run dev  # PowerShell
```

## Credits

Dev Bubbles started as a fork of [githubocto/repo-visualizer](https://github.com/githubocto/repo-visualizer) by GitHub OCTO. The circle packing and the curved labels come from that project.

## License

[MIT](LICENSE)
