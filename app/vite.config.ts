import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://seotranscure-ui.github.io/leads/ in production,
// so assets need the "/leads/" base. Local dev stays at "/".
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/leads/' : '/',
  plugins: [react()],
  server: { port: 5173 },
}))
