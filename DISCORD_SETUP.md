# Discord server — Realms of Fate

Permanent invite: **https://discord.gg/qymT99jZrN** (linked in-game on the join screen).

## What's built (done)

**Categories & channels**

| Category | Channels |
|---|---|
| INFORMATION | #rules ✍️, #introductions, #faq ✍️, #roadmap ✍️, #patch-notes, #events, #polls |
| COMMUNITY | #table-talk, #character-builds, #campaign-stories, #fan-art, #screenshots, #memes, #off-topic |
| GAME SUPPORT | #known-issues, #technical-support |
| DEVELOPMENT | #dev-updates, #feature-voting, #beta-testing, #design-feedback |
| 🎲 DUNGEON MASTERS | #dm-lounge ✍️, #dm-resources, #dm-map-sharing, #dm-tools, #dm-announcements |
| 💎 SUPPORTERS | #supporter-chat, #sneak-peeks, #beta-downloads, #supporter-polls |
| 🧪 TESTING | #alpha-testing ✍️, #closed-beta, #open-beta, #ptr-builds, #experimental-builds |
| Voice | General, Party Finder, Dungeon 1–3, Raid, Developer Lounge, AFK |

✍️ = starter post already written (rules, FAQ, roadmap, testing-program kickoff, DM welcome).
Older channels (#general, #announcements, #looking-for-group, #help-and-questions,
#bug-reports, #suggestions) still sit under "Text Channels" — drag each into its
category when you have a minute.

**28 roles created, colored, in hierarchy order:**
- Staff: 👑 Founder · 🛡 Owner · ⚙️ Lead Developer · 💻 Developer · 🤝 Community Manager · 🛠 Moderator · 💬 Support Team · 🤖 Bot Manager
- DMs: 🎲 Official DM · 🎲 Dungeon Master · ✅ Verified DM
- Testing: 🧪 Alpha Tester · 🧪 Closed Beta · 🧪 Open Beta · 🧪 PTR Tester · 🧪 Experimental Builds
- Supporters: 💎 Platinum · 🥇 Gold · 🥈 Silver · 🥉 Bronze · ❤️ Supporter
- Progression: 🏆 Day One Player · 🐛 Bug Hunter · ⚔️ Veteran · 🧙 Adventurer · 👋 New Player
- Notifications: 🔔 Patch Notes · Events · Giveaways · Looking For Group · Beta News · New Campaigns
- 🎥 Creator

**Private wings — LOCKED (done):**
- 🎲 All 5 **dm-*** channels → visible only to 🎲 Dungeon Master, 🎲 Official DM, ✅ Verified DM + Lead Dev/Mod/CM
- 💎 All 4 **supporter** channels → visible only to the 5 supporter roles + Mod/CM
- 🧪 **#alpha-testing/#closed-beta/#ptr-builds/#experimental-builds** → matching 🧪 tier + staff (#open-beta stays public on purpose)

**Read-only channels — DONE:** #rules, #announcements, #roadmap, #patch-notes,
#known-issues, #faq, #events, #polls, #dm-announcements → @everyone can read but
not post (Send Messages + threads denied). #bug-reports, #introductions,
#suggestions, #general, #help-and-questions, #looking-for-group stay writable.
Admins (👑/🛡) bypass everything and can always post.

## Your 5-minute cleanup list (quick manual bits)

1. **Delete 4 mistake channels** (created as text during automation, all empty):
   under "Voice Channels" right-click → Delete Channel on **#party-finder,
   #dungeon-1, #dungeon-2** (the # text ones — NOT the 🔊 voice ones) and ONE of the
   two duplicate **🔊 Dungeon 3** voice channels.
2. **Drag** the 6 old channels into their categories (list above).
3. **Give yourself 👑 Founder**: right-click your name → Roles.
4. **Role permissions** (Server Settings → Roles → click role → Permissions):
   - 👑 Founder + 🛡 Owner: Administrator ON
   - ⚙️ Lead Dev / 💻 Developer: Manage Channels, Manage Messages
   - 🛠 Moderator: Manage Messages, Kick, Timeout Members
   - Everything else: leave default (they're identity/ping roles).

## Bots — one-time "Authorize" clicks only you can do

1. **Carl-bot** (carl.gg) — reaction roles (post one message in #introductions: 🎲=Dungeon Master ping, 🧪=tester tiers, 🔔=notification roles), automod, logging. Covers PollBot too.
2. **Sesh** (sesh.fyi) — session scheduling with RSVPs + timezones.
3. **Ticket Tool** (tickettool.xyz) — 🎫 panel in #technical-support.
4. **Arcane/MEE6** — leveling; add when ~20 active members.
5. Skip ServerStats + Sapphire for now (overkill / overlaps Carl-bot).

Class roles (🗡 Fighter … 🔮 Chronomancer), RP roles, factions, regions, platforms:
create these as a **Carl-bot reaction-role message** rather than 60 manual roles —
members self-assign and it stays tidy. Full lists live in your blueprint message.

**Community features** (weekly events, insights): Server Settings → Enable Community
(you must accept Discord's guidelines yourself).

## Auto-role wiring (once Carl-bot is in)

Join → 👋 New Player (Carl-bot autorole) · verify/react → 🧙 Adventurer ·
buys DM Pro → you assign ✅ Verified DM · confirmed bug → 🐛 Bug Hunter ·
level milestones → Arcane auto-roles.

## Game ↔ Discord integrations (I build these in-app on request)

Webhook per channel (Edit Channel → Integrations → Webhooks → Copy URL → paste into
Render env): `DISCORD_BUG_WEBHOOK` → in-game bug reports post to #bug-reports;
`DISCORD_STATUS_WEBHOOK` → "🟢 update live" posts to #announcements;
`DISCORD_PATCH_WEBHOOK` → auto patch notes to #patch-notes.
