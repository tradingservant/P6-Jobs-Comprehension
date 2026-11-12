# P6-Jobs-Comprehension

Static one-station Primary 6 reading practice for the Bright Days Job Fair. Advertisement wording is kept from the source paper. Open `index.html` with a local static server so the page can load `data/exercises.json` and `data/passages.md`.

Links are relative, so the page can be served from a project subpath. Scores stay in the page only and clear on reset, reload, or close.

```bash
npm test
```

`npm test` checks the exercise pack and runs a headless Chrome flow. It uses `CHROME_PATH` when set, otherwise `/usr/bin/google-chrome`.
