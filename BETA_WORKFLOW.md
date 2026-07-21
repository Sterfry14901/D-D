# Alpha → Beta workflow — how we ship without breaking live games

## The setup (two copies of the game)

| Track | Branch | Site | Who plays there |
|---|---|---|---|
| 🔴 **LIVE (alpha)** | `main` | https://d-d-cfqn.onrender.com | Real players. Never gets untested code. |
| 🧪 **BETA** | `beta` | your new beta URL (see below) | You + testers from Discord 🧪 TESTING |

Both run from the SAME GitHub repo — just different branches. Each has its own
players, saves, and rooms; nothing crosses over.

## One-time setup (5 minutes, only you can do this)

The `beta` branch already exists on GitHub. Create the second Render service:

1. dashboard.render.com → **New +** → **Web Service**
2. Pick the same repo (**Sterfry14901/D-D**)
3. **Branch: `beta`** ← the important part
4. Name it `d-d-beta`, Free plan, same build/start commands (defaults are fine)
5. Copy the SAME environment variables as the live service (Env tab → add them again).
   For the beta you can skip `DISCORD_STATUS_WEBHOOK` or point it at a webhook on
   **#ptr-builds** so testers see beta deploys, not the whole server.
6. Create — you'll get a URL like `https://d-d-beta.onrender.com`. Post it in
   Discord **#beta-downloads** / **#alpha-testing**.

## How development flows from now on

- **New/risky features** → committed to the `beta` branch first → beta site updates
  → testers hammer it → bugs come in via 🐛 (straight to #bug-reports)
- **When a feature is proven** → merged `beta` → `main` (GitHub: "Compare & pull
  request" from beta into main → Merge) → live site updates
- **Emergency fixes** for live go straight to `main`, then get merged down into `beta`

Tell me "put this on beta" or "promote beta to live" and I'll handle the branch
routing on every future feature.

## Merging beta → live when a build is ready

1. github.com/Sterfry14901/D-D → **Pull requests** → **New pull request**
2. base: `main` ← compare: `beta` → **Create pull request** → **Merge**
3. Render auto-deploys live in ~90 seconds and posts 🟢 in #announcements

## Testing-tier mapping (matches the Discord roles)

- 💥 **Experimental** — ideas I prototype on `beta` behind a flag; may never ship
- 🔬 **Alpha** — everything currently going straight to live (what we've been doing)
- 🧪 **Beta / PTR** — the `beta` site: release candidates soaking before merge

As the player count grows, we flip the default: features land on `beta` first and
live only gets merges. That's the switch this file exists for.
