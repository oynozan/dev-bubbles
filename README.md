# Dev Bubbles

Dev Bubbles draws a git repository as a live map of nested bubbles in your browser and lets your coding agent name them. The agent groups the code into components with human-readable names such as Billing API or Google Connector, the map shows the imports and HTTP calls between them, and when you tell the agent something is broken it marks the suspects in red while it investigates, so you can watch the search narrow down to the cause. Everything runs on your machine with no API key: Dev Bubbles never calls an LLM, it reads the JSON files your agent writes and redraws as soon as they change.

## What you see

- A dark map of nested bubbles, one per component, sized by lines of code. The top level shows your top-level components, with no bubble around the whole repo.
- Names chosen by your coding agent. Every bubble shows the label the agent gave its component, never a file or folder name. Files are not bubbles: the innermost components hold them. Until the agent maps the repo, the bubbles follow the directory tree without names.
- A details window. Click a bubble to list its files with what each one imports, what imports it and the HTTP calls it makes, plus the bug marks on them. Clicking a group also zooms into it. Drag the window anywhere on the screen.
- Solid lines for imports and dashed lines for HTTP calls, drawn between the bubbles you can see at the current zoom.
- Bug marks: striped red for suspected, solid red for confirmed. A mark on a file shows on the bubble that holds it. A mark hidden inside a closed bubble gives that bubble a red ring and a count badge.
- A bug panel that lists the open bugs and shows why each bubble was marked.
- A commit list at the bottom left. New commits appear as you make them. Pick any of the last 100 to see the map as the repo was then, grouped and named by the current `components.json`.
- Live updates. Creating, editing or deleting a file, a commit, or the agent changing a component or a bug mark updates the map within half a second.
- Zoom with the wheel and pan with the middle mouse button, go back up with the breadcrumb, drag a bubble to pin it in place and double-click to unpin.

Edges come from JavaScript and TypeScript code: static, dynamic and `require` imports resolved with tsconfig paths, and `fetch` or `axios` calls matched to Express, Fastify, Hono and Next.js routes. Files in other languages still show up in their components, without edges.

## Install

Requires Node.js 22.12 or newer and git. In the project you want to map:

```sh
npx skills add oynozan/dev-bubbles
```

Then, in Claude Code in the same project, say "set up dev bubbles". The agent:

- clones Dev Bubbles into `.dev/dev-bubbles/` and runs `npm install` there, which also builds it and takes about a minute
- runs `init`, which creates `.dev/components.json` and `.dev/bugs.json`, gitignores the local files, copies the `/map` and `/bug` commands and the skill into `.claude/`, writes a Dev Bubbles section into `CLAUDE.md` and adds three [hooks](#hooks) to `.claude/settings.json`
- starts the map server in the background and opens the map in your browser
- maps the repo into named components and tells you the map URL

What you get:

- The map open in your browser, at http://127.0.0.1:4747 unless that port was taken.
- Every Claude Code session starts the map server by itself.
- Casual bug reports turn into live marks. Say "the export button does nothing" and the agent opens a bug and marks the suspects before it reads any code, without `/bug`.
- New files and commits show up live.
- The agent keeps the components current. When it adds, moves or deletes code it updates `components.json` in the same turn, and a hook keeps it from finishing while files are unmapped.

Everything Dev Bubbles owns lives in `.dev/`. To update, ask the agent to set up Dev Bubbles again, or run the first three manual steps below.

### Manual install

From the root of the project:

```sh
git clone https://github.com/oynozan/dev-bubbles.git .dev/dev-bubbles
npm install --prefix .dev/dev-bubbles
node .dev/dev-bubbles/dist/bin/cli.js init .
node .dev/dev-bubbles/dist/bin/cli.js up --open
```

If the clone already exists, run `git -C .dev/dev-bubbles pull` instead of the first line. Then run `/map` in Claude Code to name the components.

If you prefer a global command, clone Dev Bubbles anywhere outside the project, run `npm install` and `npm link` in the clone, and use `dev-bubbles init .` and `dev-bubbles up --open` in the project. The hooks and the `CLAUDE.md` section then point at that clone by its absolute path. A global install straight from GitHub (`npm install -g github:oynozan/dev-bubbles`) does not work, because npm leaves out the build tools when it prepares a git package for a global install.

Below, `dev-bubbles` stands for `node .dev/dev-bubbles/dist/bin/cli.js` run from the project root, or the global command.

## Test the bug flow

The marks come from `.dev/bugs.json`, so anything that writes that file moves them. Open the map first, then try one of these.

### With your agent

In Claude Code in the mapped project, describe a problem the way you would to a colleague, for example "saving the profile shows a blank page". The agent opens a bug with striped suspects before it reads any code, narrows them while it investigates, turns the cause solid red and sets the bug to fixed once the fix is in. `/bug <description>` does the same on purpose.

### Scripted demo

In a clone of Dev Bubbles, `npm run demo:bug` plays a made-up bug in about 4 seconds per step: three suspected components, then one of them and one of its files, then that file confirmed, then fixed, so the marks clear. At the end it removes the demo bug and leaves any other bugs alone.

```sh
npm run dev                        # terminal 1, the map of this repository at http://localhost:5173
npm run demo:bug                   # terminal 2
npm run demo:bug -- /path/to/repo  # or any repository that has a components.json
```

Without a path it uses `$DEV_BUBBLES_REPO`, then the clone itself.

### By hand

Run the bug commands yourself and watch each one land. Put a component id from your `components.json` in place of `auth` and a file of yours in place of `src/auth/session.ts`:

```sh
dev-bubbles bug open "Trying out the marks"                       # prints the id, b1 here
dev-bubbles bug mark b1 auth suspected "just testing"
dev-bubbles bug mark b1 src/auth/session.ts confirmed "found it"
dev-bubbles bug clear b1 auth
dev-bubbles bug fix b1
dev-bubbles bug list
```

Editing `.dev/bugs.json` by hand works too. The [skill](skills/dev-bubbles/SKILL.md) describes the format, a mistake shows in the error banner, and `dev-bubbles validate .` prints it with its JSON path.

### Why it is real-time

Nothing polls. The server watches the files, the git index and HEAD, and the `.dev/` JSON files. On a change it rebuilds the snapshot and pushes it to every open map over Server-Sent Events, about 0.4 s after the save or commit. If the server restarts, the map reconnects on its own.

## CLI

```
dev-bubbles <command> [repo] [options]
```

`[repo]` defaults to the current directory, and the bug commands take no `[repo]`. Any folder inside a git repository works, Dev Bubbles always maps the whole repository.

| Command | What it does |
| --- | --- |
| `serve` | Serve the live map in the foreground at port 4747, or a free port when 4747 is busy and no `--port` was given. Writes `.dev/server.json` while it runs. This is the default command |
| `up` | Start the map server in the background unless one already runs for this repo, and print its URL. Logs go to `.dev/server.log` |
| `down` | Stop the background server |
| `init` | Create `.dev/components.json` and `.dev/bugs.json`, add the gitignore entries, copy the `/map` and `/bug` commands and the skill into `.claude/`, write the Dev Bubbles section into `CLAUDE.md` and merge the hooks into `.claude/settings.json`. Safe to re-run |
| `summary` | Print a compact overview for the agent: directories with file counts and lines of code, top cross-directory imports, components, components with both own files and sub-components, unmapped files and unmatched HTTP calls |
| `validate` | Check `components.json` and `bugs.json`, print each error with its JSON path, and exit 1 on any error |
| `hook <session\|prompt\|stop>` | Run by the Claude Code hooks |

| Bug command | What it does |
| --- | --- |
| `bug open <title...>` | Add an open bug and print its id, such as `b3` |
| `bug mark <id> <target> <suspected\|confirmed> [reason...]` | Mark a component id or a repo file path |
| `bug clear <id> <target>` | Remove the mark on a target |
| `bug fix <id>` | Set the bug to fixed, which takes its marks off the map |
| `bug list` | Print the open bugs and their marks |

Every bug command validates its input, sets `updatedAt` and writes `bugs.json` atomically.

| Option | Default | |
| --- | --- | --- |
| `--repo <path>` | `$DEV_BUBBLES_REPO`, then the current directory | Repository when `[repo]` is not given, and for the bug commands |
| `--port <n>` | `4747`, or a free port when it is busy | Port for `serve`, `0` picks a free one |
| `--open` | off | Open the map in the browser after `up` |
| `--tracked-only` | off | Leave out files git does not track (`serve`, `summary`, `validate`) |
| `-h`, `--help` | | Show the help |

By default the map holds every file from `git ls-files --cached --others --exclude-standard`, so new files show up before they are committed and gitignored files never do. Binary files and files over 1 MB are left out. The server only listens on `127.0.0.1`.

## Hooks

`init` merges three hooks into `.claude/settings.json` and leaves your other settings alone.

| Hook | What it does |
| --- | --- |
| SessionStart | Starts the map server if it is not running and gives the agent the map URL and the standing rules: record bug reports at once, keep `components.json` current, offer to map the repo if it has no components |
| UserPromptSubmit | When your message reads like a problem report ("doesn't work", "broken", "error", "wrong"), reminds the agent to record the bug on the map before investigating, with the exact commands |
| Stop | When the map is out of date (files that match no component, components with no files, invalid JSON, bad marks), keeps the agent from finishing its turn until it updates `.dev/components.json` or `.dev/bugs.json`, at most once per turn |

## The .dev/ folder

| Path | Written by | Commit it |
| --- | --- | --- |
| `dev-bubbles/` | the setup, a clone of Dev Bubbles | no, `init` gitignores it |
| `components.json` | the agent | yes |
| `bugs.json` | the agent, through the bug commands | no, `init` gitignores it |
| `layout.json` | the map, when you drag a bubble | no, `init` gitignores it |
| `server.json` | the running map server, its pid and URL | no, `init` gitignores it |
| `server.log` | the background server that `up` starts | no, `init` gitignores it |

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

The [skill](skills/dev-bubbles/SKILL.md) describes both formats in full, and this repository maps itself in [.dev/components.json](.dev/components.json). A broken file never stops the server: the map keeps the last valid version and shows the error in a banner until it is fixed.

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
| `npm start -- <command> [repo]` | Run the built CLI |
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
