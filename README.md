# RetailPOS Mobile Dashboard

A phone-friendly web dashboard for your RetailPOS data stored in Supabase.

## What it shows
- sales summary
- daily and monthly charts
- cashier performance
- top products
- low stock items
- full inventory with selling price, cost, and stock

## Before you start
This app expects your Supabase project to already have the tables/views/function from your RetailPOS autosync SQL.

## Setup in VS Code
1. Open this folder in VS Code.
2. Copy `.env.example` to `.env.local`.
3. Fill these values in `.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_DEFAULT_STORE_ID`
4. Open a terminal in this folder.
5. Run:

```bash
npm install
npm run dev -- --host
```

6. Open the URL shown in the terminal on your phone while both devices are on the same Wi-Fi.

## Build for deployment
```bash
npm run build
npm run preview
```

## Where to change the store
Inside the app, open the **Settings** tab and change the Store ID. It is saved in your browser on the phone.

## Files you usually edit
- `src/App.jsx`
- `src/index.css`
- `src/lib/supabase.js`

## Notes
- This is a mobile web app, not an Electron app.
- It reads Supabase directly.
- If the dashboard is empty, first confirm your POS is syncing to Supabase.
- No Supabase SQL change is needed just to show inventory and price. This app reads the existing `inventory` table.
