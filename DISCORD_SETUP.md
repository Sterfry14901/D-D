# Discord server — Realms of Fate

Permanent invite: **https://discord.gg/qymT99jZrN** (also linked in-game on the join screen).

## What's built (done for you)

**Categories & text channels**

| Category | Channels |
|---|---|
| INFORMATION | #rules, #announcements*, #introductions, #faq, #roadmap, #patch-notes, #events, #polls |
| COMMUNITY | #general*, #table-talk, #character-builds, #campaign-stories, #fan-art, #screenshots, #memes, #off-topic |
| GAME SUPPORT | #help-and-questions*, #bug-reports*, #suggestions*, #known-issues, #technical-support, #looking-for-group* |
| DEVELOPMENT | #dev-updates, #feature-voting, #beta-testing, #design-feedback |
| VOICE | General, Party Finder, Dungeon 1–3, Raid, Developer Lounge, AFK |

\* created earlier under "Text Channels" — drag them into their category in the sidebar (10 seconds each; drag-and-drop can't be automated safely).

Starter content is posted in #rules, #faq and #roadmap. A welcome message with the
game link is pinned in #general.

## What only YOU can do (each is a one-time OAuth "Authorize" click)

Bots install through Discord's authorization screen tied to your account — that's a
permission grant I won't click for you. Order of value:

1. **Carl-bot** — carl.gg → *Invite* → pick "Realms of Fate". Gives you:
   - **Reaction roles** (Dashboard → Reaction Roles): post a message in #roles,
     members react 🎲=Player, 🐉=DM, 🔔=Updates to self-assign roles.
   - **Automod** (Dashboard → Automod): block invite links + mass mentions, that's
     enough for a small server.
   - **Logging**: set a private #mod-log channel.
2. **Sesh** — sesh.fyi → *Add to Discord*. Session scheduling with RSVPs and
   time-zone conversion — perfect for game nights. Covers what PollBot/Apollo would do.
3. **Ticket Tool** — tickettool.xyz → *Invite*. Panel in #technical-support; members
   click 🎫 to open a private help thread.
4. **Arcane or MEE6** (leveling) — arcane.bot. XP per message, level-up announcements,
   auto-role at level 5/10/20. Skip until you have ~20 active members; leveling in an
   empty server feels dead.
5. **ServerStats** — only worth it past ~50 members.

Skip Sapphire for now — Carl-bot covers the same ground; two automod bots fight each other.

**Roles** (Server Settings → Roles → Create Role) — suggested minimal set:
- 🛡️ **Game Master** (you) — Administrator
- ⚔️ **Moderator** — Manage Messages, Kick, Timeout
- 🎲 **Player**, 🐉 **DM**, 🔔 **Updates** — no permissions, just pingable + colored;
  hand these to Carl-bot reaction roles.
- Class roles (🗡 Fighter, ✨ Wizard…) are fun flair once the server is active — add
  them as a second reaction-role message later.

**Read-only channels**: for #rules, #announcements, #roadmap, #patch-notes,
#known-issues: channel → Edit Channel → Permissions → @everyone → deny **Send Messages**.
(Two clicks each; wants your judgment on which stay open.)

**Community features** (weekly events, monthly contests, Server Insights) unlock via
Server Settings → Enable Community — requires you to accept Discord's community
guidelines, so that toggle is yours.

## Game ↔ Discord integrations (I can build these in-app — say the word)

- **Bug reports → #bug-reports** via a Discord webhook: create one in
  #bug-reports → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL,
  then add it as `DISCORD_BUG_WEBHOOK` in Render env. I'll add an in-game
  "Report bug" button that posts straight to the channel.
- **Live status → #announcements**: server posts "🟢 back online after update"
  through the same webhook mechanism (`DISCORD_STATUS_WEBHOOK`).
- **Auto patch notes → #patch-notes**: each deployed feature posts its one-liner.
- **LFG bridge**: "Find a party" button in the game linking to #looking-for-group
  (already exists — the in-game Discord button covers this).

## Long-term (revisit at 100+ members)

Community events calendar (Sesh), monthly build contests in #character-builds,
featured fan-art role, AI helper bot answering rules questions from the SRD, and a
public roadmap vote pinned in #feature-voting.
