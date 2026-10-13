# Stonebyte: getting it online for free

Order matters. Everything below is free. You need a GitHub account, a Render account and your Discord bot.

## 1. GitHub: the code and the two free builders
1. Make a GitHub account (say it's `yourname`).
2. Create a **public** repository named exactly `yourname.github.io`.
3. Put this whole folder in it. Easiest: install **GitHub Desktop**, choose File > Add local repository (this folder), then Publish repository, make sure it's the `yourname.github.io` one and **not** private.
4. Open the repo on github.com > Settings > Pages > Source: choose **GitHub Actions**.
5. Go to the **Actions** tab. "Stonebyte server image" starts by itself after your first upload (10 to 20 minutes: it builds the game engine). Wait for the green tick. If it fails, copy the red error text to Claude.
6. Your profile > Packages > `stonebyte-server` > Package settings > change visibility to **Public** (so Render can fetch it).

## 2. Render: the game server
1. render.com > sign up (no card) > New > **Web Service** > **Existing Image**.
2. Image URL: `ghcr.io/yourname/stonebyte-server:latest` (all lowercase). Instance type: **Free**.
3. Pick a name, for example `stonebyte-server`. Its address will be `https://stonebyte-server.onrender.com` (Render shows the real one).
4. Environment variables (add each):

| Name | Value |
|---|---|
| `PUBLIC_URL` | `https://stonebyte-server.onrender.com` (the real address) |
| `SITE_ORIGINS` | `https://yourname.github.io` |
| `BACKUP_DISCORD_TOKEN` | your bot token (only here, never in a file) |
| `BACKUP_DISCORD_CHANNEL` | the channel ID |

5. Create the service. Open its **Logs**: you should see the server start and a line like `[backup] accounts.sqlite: no saved copy yet (starting fresh)`.

## 3. The website
1. GitHub repo > Settings > Secrets and variables > Actions > **Variables** > New repository variable:
   name `GAME_SERVER`, value `wss://stonebyte-server.onrender.com` (same address as above, but `wss://`).
2. Actions tab > "Stonebyte site" > **Run workflow**. When green, your site is `https://yourname.github.io/`.

## 4. Partytime
Use `index-partytime.html` (next to this file): change `YOUR-USERNAME` in it, then replace your Partytime `index.html` with it. It shows your site full-screen, like your old one did.

## 5. Check that saving works
1. Open the site, type a name, press Play.
2. Wait about 6 minutes. In Discord, the private channel should get a message with `accounts.sqlite.gz`. In Render's logs: `[backup] accounts.sqlite: saved ... bytes to Discord channel ...`.
3. In Render, use Manual Deploy > Restart. After it wakes, type the **same name**: your progress should still be there, and the logs say `brought back ... bytes`.

## Things to know
- The free server sleeps after 15 idle minutes; the first visitor waits about a minute. It has a tiny CPU (0.1), so games may lag. If so, tell Claude: the fallback is running the server on your own computer.
- You can lose up to 5 minutes of progress if Render restarts the server without warning.
- Anyone can type anyone's name: there's no password yet.
- `public/privacy.html` and `public/upload-terms.html` were only renamed. They still describe the original site (Discord sign-in, Vercel, Fly.io) and have placeholders like `[contact email]`. Rewrite them before you share the site widely.
- The bot token and channel ID were pasted into a chat. Reset the token in the Discord developer portal (Bot > Reset Token) before real use, and update it in Render.
- Not tested end to end: Claude can't run any of this. Expect to fix a few things; send the error text.
