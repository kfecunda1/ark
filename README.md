# ARK

A private, two-user tracker for banking-product client projects — built on Next.js and Supabase. The banking products and document types it tracks (SBLC, MX103, MT103, … and CIS, POF, DOA, … by default) are admin-managed in Settings, not hard-coded.

See `AGENTS.md` for the module map and the two-phase database migration plan.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on `/login`.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run a production build
- `npm run lint` — lint
