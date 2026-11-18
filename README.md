# Hemplan

Plan an apartment or house in 3D: draw walls from a floor plan, furnish, paint, walk around, and simulate sunlight and lamps.

There are two versions built from the same source:

| Version | GitHub Pages | Claude |
|---|---|---|
| **Hemplan 3D**: home planner | https://hemplan.github.io/ | https://claude.ai/artifact/SQ6qEdbTfwtsJMcC3HZ4Ze |
| **Hemplan Pro**: adds cameras and alarm devices | https://hemplan.github.io/arbete/ | https://claude.ai/artifact/Xvk4PM1qbAnR6a4uxfYS4o |

Opened in Claude, the pages also get the Claude features: creating furniture from text, photos and product links, reading floor plans, share links and shared templates. On GitHub Pages these are hidden.

## Source

```
src/core/page.html   page markup (shared)
src/core/app.css     styles (shared)
src/core/app.js      all shared logic; variants plug in through HOOKS
src/work/work.html   extra panels for the work version
src/work/work.css    extra styles for the work version
src/work/work.js     cameras, detectors, coverage, camera view, equipment list
build.py             builds both versions
docs/                GitHub Pages output (generated, do not edit by hand)
docs/templates.json  shared furniture templates for the GitHub version
```

Build after every change, and commit `src/`, `build.py` and `docs/` together:

```bash
python3 build.py
```

`build/` (ignored by git) gets the files that are published as the Claude artifacts.
