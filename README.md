# Gym Crew

A workout and habit tracker for Abey, Sudheep and Ashik. It's a static PWA (plain HTML, CSS and JavaScript) with no build step, no backend and no dependencies. It works offline after the first load.

```
index.html             app shell
styles.css             dark, mobile-first styles
app.js                 UI, routing, storage, progression logic
data.js                people, targets, workouts, exercises, image list  ← edit the plan here
sw.js                  service worker (offline cache, CACHE_VERSION)
manifest.webmanifest   install metadata
icons/                 app icons
images/equipment/      equipment photos (filenames are referenced from data.js)
```

## Deploy to GitHub Pages

1. Create a repository on GitHub (for example `gymcrew`).
2. Push this folder to the `main` branch:
   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   ```
   ```bash
   git push -u origin main
   ```
3. On GitHub, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then pick branch `main` and folder `/ (root)`, and click **Save**.
4. Wait a minute, then open `https://<user>.github.io/<repo>/`.

All paths are relative, so the app works from the `/<repo>/` sub-path without any changes.

To try it locally (the service worker needs `http://localhost` or HTTPS):

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080/.

## Install on a phone

- **iPhone (Safari):** open the site, tap **Share → Add to Home Screen**, then open Gym Crew from the home-screen icon. Use the home-screen app rather than a Safari tab: Safari can clear data for websites you haven't opened in 7 days, but the home-screen app keeps it.
- **Android (Chrome):** open the site, then tap **Install app** (or menu ⋮ → **Install app** / **Add to Home screen**).

Each person types their name on first open. The app remembers them after that, and **Settings → Switch user** changes who is signed in.

## Edit the plan

Everything about the people and the training plan is in `data.js`:

- `USERS`: names, start dates, daily targets (calories, protein, steps, sleep), the starting body scan and monthly milestones.
- `WEEKLY_TARGETS`, `DELOAD_WEEKS`, `PLAN_WEEKS`.
- `WORKOUTS`: the four workouts in `WORKOUT_ORDER`. Each exercise has `sets`, `reps: [min, max]`, `rest` (seconds), `tier` (`core` / `full` / `extra`, which controls what appears at 45 / 60 / 75 minutes), an optional `cue`, `superset`, `inc` (kg to add when the top of the range is hit, default 2.5), `assisted` (assist kg goes down as you get stronger) and `perSide`.
- `IMAGES`: equipment photo filenames in `images/equipment/`. The service worker precaches every file listed here.

Rules for safe edits:

1. **Keep exercise `id`s stable.** Logged sets are stored against them. You can change names, cues, sets, reps, rest and tiers freely. If you really must rename an id, add a migration in `app.js` (see `MIGRATIONS` and `SCHEMA_VERSION`, which includes an example) so old logs move to the new id.
2. **Bump the version** so phones pick up the change. In `sw.js`, change `CACHE_VERSION` (for example `gymcrew-v1.0.0` → `gymcrew-v1.0.1`), and update `APP_VERSION` in `data.js` to match (it's shown in Settings). The next time someone opens the app, it downloads the new files and shows **"Update available — tap to refresh"**.
3. If you add a new photo, put it in `images/equipment/` and add it to `IMAGES` so it works offline.

## Your data

- Data is stored **only on each person's own phone** (localStorage key `gymcrew:v1:<name>`). Nothing is uploaded, and the three people's data is kept separate.
- Everyone should **export a backup monthly**: **Settings → Export backup** downloads `gymcrew-<name>-<date>.json`. Keep it in iCloud Drive, Google Drive or email. **Import backup** restores it (it checks the file belongs to you and asks before overwriting).
- Clearing Safari/Chrome website data, or deleting the home-screen app, erases the data. A backup is the only way to get it back.
