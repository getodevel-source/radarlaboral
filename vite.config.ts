import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import { notBundle } from 'vite-plugin-electron/plugin'
import react from '@vitejs/plugin-react'
import { createContentSecurityPolicyPlugin } from './build/content-security-policy.mjs'

export default defineConfig(({ command }) => ({
  base: './',
  build: { sourcemap: false },
  plugins: [
    react(),
    createContentSecurityPolicyPlugin(command),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: { plugins: [notBundle()] },
      },
      preload: { input: path.join(import.meta.dirname, 'electron/preload.ts') },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
}))
