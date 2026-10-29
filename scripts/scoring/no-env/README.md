# No environment files

The local scoring test server (`vite.scoring.config.mjs`) reads environment settings from this folder, which deliberately has no `.env` files, so `.env.local` and its Supabase settings are never loaded by that server. Do not add environment files here.
