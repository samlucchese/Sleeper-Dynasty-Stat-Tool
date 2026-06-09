# Sleeper Dynasty League Hub

Static, mobile-first GitHub Pages dashboard for Sleeper dynasty leagues.

## League

The app is preconfigured for league ID:

```js
1326629536078528512
```

## Deploy to GitHub Pages

1. Create a new GitHub repo.
2. Upload `index.html`, `styles.css`, and `app.js` to the repo root.
3. In GitHub, go to **Settings → Pages**.
4. Set source to **Deploy from a branch**, branch `main`, folder `/root`.
5. Open the Pages URL on your iPhone.

## What it pulls from Sleeper

- League details
- Previous season chain when `previous_league_id` exists
- Users and rosters
- Weekly matchups
- Weekly transactions
- Completed trades
- Traded draft picks endpoint is loaded for future expansion
- Winners bracket where available

## Included stats

- Career and season records
- Points for / points against
- All-play based expected wins
- Luck wins: actual wins minus expected wins
- Weekly high and low scores
- Championships and runner-up finishes when bracket data is available
- Trade center grouped by manager sides
- Manager search
- Manager comparison
- Auto awards/accolades

## Notes

Sleeper's public API is read-only and does not require an API key. If a league is private or old season links are missing, some history may be incomplete.
