# Dev Bubbles

A local, live bubble map of a git repository. Files are drawn as nested circles, sized by lines of code and colored by language, and the map updates as files change.

Your coding agent (Claude Code, for example) groups the code into human-readable components in `.dev-bubbles/components.json`, and marks the components involved in a bug in `.dev-bubbles/bugs.json`. Without a manifest the map falls back to the directory tree. See [PLAN.md](PLAN.md) for the full roadmap.

> **Status:** early. The live map with zoom, drag and pins, the components manifest and the CLI commands work. The server already detects import and HTTP edges and resolves bug marks; drawing them on the map comes next.

## Quick start

Requires Node.js 22.12 or newer and git.

```sh
git clone <this repo> dev-bubbles
cd dev-bubbles
npm install
npm run build
npm start -- --repo /path/to/your/repo
```

Then open the printed URL (default `http://127.0.0.1:4747`). The server only listens on `127.0.0.1`.

| Command | |
| --- | --- |
| `serve [repo]` | Serve the live map (default command) |
| `init [repo]` | Create `.dev-bubbles/`, gitignore `bugs.json` and `layout.json`, copy the `/map` and `/bug` commands and the agent skill into `.claude/` |
| `summary [repo]` | Print a compact overview of the repo for a coding agent |
| `validate [repo]` | Check `components.json` and `bugs.json`, exit 1 on any error |

| Option | Default | |
| --- | --- | --- |
| `--repo <path>` | current directory | Repository when `[repo]` is not given |
| `--port <n>` | `4747` | Port to listen on |
| `--tracked-only` | off | Leave out files git does not track |

## Development

```sh
npm run dev          # server (tsx watch) + Vite dev server on http://localhost:5173
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run fixture      # copies fixtures/sample-app into a temp git repo and prints its path
```

`npm run dev` maps the Dev Bubbles repo itself. To map another repo, set `DEV_BUBBLES_REPO`:

```sh
DEV_BUBBLES_REPO=/path/to/repo npm run dev            # bash
$env:DEV_BUBBLES_REPO = "C:\path\to\repo"; npm run dev  # PowerShell
```

## Credits

Dev Bubbles started as a fork of [githubocto/repo-visualizer](https://github.com/githubocto/repo-visualizer) by GitHub OCTO. The circle packing and rendering come from that project.

## License

[MIT](LICENSE)
