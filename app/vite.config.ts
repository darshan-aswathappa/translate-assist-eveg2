import { defineConfig } from "vite";

// No dev proxy needed: the app talks straight to Supabase Edge Functions, which
// we control and which return permissive CORS headers. `--host` (in the dev
// script) exposes the server on the LAN so the Even app can sideload it via
// `npx evenhub qr --url http://<mac-ip>:5173`.
export default defineConfig({});
