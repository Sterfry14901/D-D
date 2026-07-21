# DM Pro — how to turn on paid DM seats (players always free)

The app now has a complete license system built in. It is **OFF by default** — nothing
changes for anyone until you flip it on. When on, taking the **GM seat requires a valid
license key**; players never pay and are never gated on anything.

## How it works

- The DM pastes a license key once (🔑 DM Pro button on the join screen, or the popup
  that appears automatically when they try to DM). The key is saved in their browser
  and sent with every join.
- The **server** verifies the key — against your Gumroad product, or against a list of
  keys you set yourself. Verified keys are cached for 24h, so a Gumroad outage never
  locks out a working DM mid-session.
- If a DM without a key tries to claim the GM seat, they join as a player and the
  DM Pro popup opens with your "Get DM Pro" buy link. The moment they activate a valid
  key, they're promoted to GM on the spot — no rejoin needed.
- Security: keys are never trusted from the browser; a valid key with the **wrong room
  GM password still doesn't get the seat**; activation attempts are rate-limited.

## Step 1 — Create your Gumroad product (you do this, ~10 minutes)

1. Sign up at **gumroad.com** (free) and create a product, e.g. "DM Pro — lifetime"
   (or a membership for a monthly subscription — both work).
2. In the product's settings, enable **"Generate a unique license key per sale."**
3. Publish it and copy two things:
   - your **product ID** (Gumroad shows it where license keys are enabled; it's also in
     the product URL / API section)
   - your **product page URL** (what customers visit to buy)

## Step 2 — Set the environment variables on Render

In your Render dashboard → your service → **Environment**, add:

| Variable | Value | What it does |
|---|---|---|
| `DM_PRO_MODE` | `required` | Turns the gate on. Set `off` (or remove) to disable. |
| `GUMROAD_PRODUCT_ID` | your product ID | Lets the server verify keys with Gumroad. |
| `DM_PRO_URL` | your product page URL | The "Get DM Pro →" button in the popup. |
| `DM_LICENSE_KEYS` | `MY-OWN-KEY,FRIEND-KEY` | Optional: comma-separated keys that are always valid — give yourself one, comp your friends. |
| `DM_PRO_TRIAL` | `3` (default) | Free trial: an unlicensed DM can run each table for this many separate days before the paywall. Set `0` for no trial. Tied to the room, so resetting the trial means abandoning the campaign. |

Save — Render restarts automatically and the gate is live.

## Step 3 — Test it

1. Open the site in a private window, enter a GM password → the DM Pro popup should appear.
2. Paste one of your `DM_LICENSE_KEYS` (or a real Gumroad key from a test purchase)
   → "✅ License valid" → you're promoted to GM instantly.
3. Join from another window with **no** GM password → plays free, sees no popup.

## Pricing (subscription-first)

- **Main product: subscription** — a Gumroad *membership* at **$7–9/mo** per DM seat.
  Canceled or failed subscriptions are auto-detected and the key stops working.
  ~13–23 subscribers covers a $100/mo goal after Gumroad's cut.
- **No cheap lifetime.** If you offer lifetime at all, price it as a premium anchor
  (e.g. **$1,000 "forever" tier**) — it makes the monthly price look tiny and the rare
  buyer is pure upside. Otherwise skip lifetime entirely.
- Optional launch lever: a **first-month discount code** on the subscription
  (Gumroad supports discount codes) instead of discounting the base price.

## Refunds & abuse

Refunded or charged-back purchases fail verification automatically (checked every 24h).
To ban a shared key immediately, refund that sale on Gumroad.
