# Dev Bubbles

A local, live bubble map of a git repository. Folders and files are drawn as nested circles, sized by how big they are and colored by language.

Where it is headed: your coding agent (Claude Code, for example) groups the code into human-readable components, imports and HTTP calls are drawn as edges, and when you report a bug the agent marks the components that could be involved. See [PLAN.md](PLAN.md) for the full roadmap.

> **Status:** early. Phase 0 is done, which means a static circle pack of a repo served by a local Node process. Live updates, zoom and drag, components, edges and bug marks come in the next phases.

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

| Option | Default | |
| --- | --- | --- |
| `--repo <path>` | current directory | Repository to map |
| `--port <n>` | `4747` | Port to listen on |

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
