import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  server: {
    // Lets `npm run dev` here proxy API/ping calls to a separately-running
    // `wrangler dev` (see ../package.json's `dev:web` script), so the UI
    // can be iterated on with instant HMR against a real backend instead
    // of needing a full rebuild+redeploy cycle per change.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ping': 'http://127.0.0.1:8787',
    },
  },
})
