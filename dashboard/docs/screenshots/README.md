# Sample screenshots

These PNGs were captured from the local dashboard's `/demo` page. All watch names, readings, location markers, and history records come from `lib/demo.ts` and `lib/demo-history.ts`; no COSMO credentials or live API reads were used.

- `overview.png`: desktop overview at 1440 × 1000.
- `steps.png`: the Steps panel with its default 30-day chart.
- `history.png`: expanded Saved history showing fictional location reports.

Map backgrounds are OpenStreetMap tiles; attribution is visible in the screenshots. Marker locations are illustrative demo coordinates, not family locations.

To update them, run `npm run dev` from `dashboard/`, open the local `/demo` URL using simulated local sign-in, and capture these views. Wait for fonts, charts, and map tiles to finish rendering. Always verify the Fictional demo badge before capturing and never substitute the live dashboard.
