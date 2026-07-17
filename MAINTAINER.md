# D&D VTT — Maintainer Guide (fix it yourself, no AI needed)

This is your long-term "how do I fix this myself" manual. The whole app is plain
files — no build step, no framework. If you can edit a text file and click
"Commit", you can fix and ship anything here.

---

## 1. How the whole thing is wired

```
You edit a file  →  Commit to GitHub (main)  →  Render auto-deploys  →  live in ~2-3 min
   (browser)          github.com/Sterfry14901/D-D        onrender.com
```

- **Repo:** https://github.com/Sterfry14901/D-D  (branch: `main`)
- **Live site:** https://d-d-cfqn.onrender.com
- **Host:** Render.com — it watches `main` and redeploys automatically on every commit.
- **No build:** the browser loads the raw `.js` / `.css` / `.html` files directly.

There is **nothing to compile**. What you commit is exactly what runs.

---

## 2. The file map (everything lives in the repo root)

| File           | What it controls |
|----------------|------------------|
| `index.html`   | Page structure — buttons, tabs, panels, modals. Add a button here. |
| `app.js`       | **The brain.** Character sheet, tokens, dice, rests, level-up, map, chat, relay. Most fixes live here. |
| `style.css`    | All looks — colors, layout, sizes, z-index (what stacks on top). |
| `server.js`    | The Node server — realtime rooms (Socket.io) + the AI DM proxy. |
| `spells.js`    | Spell data + class/level gating + cantrip/prepared-spell helpers. |
| `classes.js`   | Classes, species, backgrounds, spell-slot tables, features per level. |
| `items.js`     | Magic item catalog. |
| `bestiary.js`  | Built-in monsters. |
| `tables.js`    | Random roll tables. |
| `rules.js`     | Misc rules helpers. |

**Rule of thumb:** looks → `style.css`; behavior → `app.js`; the server/AI → `server.js`; game data → `spells.js`/`classes.js`/`items.js`.

---

## 3. Make a change and ship it (the normal path)

1. Go to the repo, open the file (e.g. `app.js`), click the **pencil ✏️** (Edit).
2. Make your change.
3. Scroll down → **Commit changes** (commit straight to `main`).
4. Wait ~2-3 minutes. Reload the live site with a hard refresh (Ctrl/Cmd+Shift+R).

That's it. Render redeploys on its own.

> Tip: client files (`app.js`, `style.css`, `index.html`, `spells.js`, etc.)
> go live in ~2 min. Changing `server.js` restarts the server, so give it ~3 min.

---

## 4. ALWAYS syntax-check before you commit (saves you from a blank page)

A single typo in `app.js` can white-screen the whole app. Check first:

- **Online, zero setup:** paste the file into https://jshint.com — it flags the bad line.
- **On your computer (if you have Node):**
  ```
  node --check app.js
  node --check server.js
  ```
  No output = good. An error = it tells you the file and line number.

If the site goes blank after a deploy, it's almost always a JS syntax error — open the browser Console (F12) and it names the file + line.

---

## 5. Run it on your own computer first (optional but safest)

If you have Node installed:

```
git clone https://github.com/Sterfry14901/D-D
cd D-D
npm install
node server.js
```

Open http://localhost:3000 — you're now editing and testing locally with zero risk
to the live game. When it works locally, commit it.

---

## 6. Undo a bad change (rollback)

Everything is versioned in Git. To go back:

1. Repo → **Commits** (the clock/history icon).
2. Find the last good commit → click it → **Browse files** → or use **Revert**.
3. Or on any file: **History** → open the older version → copy it back in → commit.

Render will redeploy the reverted state automatically. Nothing is ever truly lost.

---

## 7. The AI DM + your Ollama / self-hosted setup

The AI DM lives in `server.js` (function `callOpenAIDM`). It is **provider-agnostic**
through two environment variables you set in the **Render dashboard → your service →
Environment**:

| Env var           | What to set it to |
|-------------------|-------------------|
| `OPENAI_API_KEY`  | Your OpenAI key — **or leave blank when using a local model that needs no key.** |
| `OPENAI_BASE_URL` | Point this at any OpenAI-compatible server. |

**Examples:**

- **OpenAI (default):** leave `OPENAI_BASE_URL` unset. Set `OPENAI_API_KEY`.
- **Ollama on your home PC, exposed online:**
  `OPENAI_BASE_URL = http://YOUR-PUBLIC-ADDRESS:11434/v1`
  (Ollama serves an OpenAI-compatible API at `/v1`. Set `OPENAI_MODEL` to e.g. `llama3.1`.)
- **LM Studio:** `OPENAI_BASE_URL = http://YOUR-ADDRESS:1234/v1`.

To make your home Ollama reachable from Render:
- Easiest & safest: run a tunnel — **Cloudflare Tunnel** (`cloudflared`) or **ngrok** —
  and use the https URL it gives you as `OPENAI_BASE_URL` (+ `/v1`).
- Or open/forward the Ollama port on your router (less safe; add an auth proxy).

**Security note:** never paste your OpenAI key into a file in the repo — it's public.
Keys go **only** in Render's Environment settings. `server.js` reads them from there.

The DM code already retries on rate-limits and gives clear messages
(rate-limited vs out-of-credits vs bad-key), so a local model with no billing
never hits the 429 problem.

---

## 8. Quick "where do I change X?" cheat sheet

| I want to…                                   | Edit | Look for |
|----------------------------------------------|------|----------|
| Change a color / size / what's on top        | `style.css` | the class name, or `z-index` |
| Fix a button that does nothing               | `app.js`  | the button's `id` or `data-…` handler |
| Change what a Short/Long Rest does           | `app.js`  | `function doRest` |
| Change level-up behavior                     | `app.js`  | `function levelUp` / `applyLevelUp` |
| Add/curate a spell                           | `spells.js` | `SPELLS` array |
| Add a magic item                             | `items.js` | the items array |
| Add a monster                                | `bestiary.js` | the monsters array |
| Change class features / slots                | `classes.js` | `CLASSES`, `FULL_SLOTS`, `LEVEL_FEATURES` |
| Change the AI DM prompt / model / provider   | `server.js` | `callOpenAIDM`, env vars |
| Add a new button to the page                 | `index.html` (add the element) + `app.js` (wire it) |

---

## 9. Golden rules

1. **Syntax-check before every commit** (Section 4). One typo = white screen.
2. **Never put API keys in the repo.** They go in Render → Environment only.
3. **Commit small changes.** Easier to spot what broke and to roll back.
4. **Hard-refresh** the live site after a deploy (Ctrl/Cmd+Shift+R) or you'll see the old cached file.
5. When stuck, open the browser **Console (F12)** — it names the exact file and line.
