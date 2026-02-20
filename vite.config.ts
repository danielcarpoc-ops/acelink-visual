import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { rmSync } from 'node:fs'
import type { Plugin } from 'vite'

// Clean dist-electron before build
rmSync('dist-electron', { recursive: true, force: true })

// Remove crossorigin attributes from generated HTML so assets load correctly
// when served via file:// in a packaged Electron app.
function removeCrossOrigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html) {
      return html
        .replace(/\s+crossorigin(?:="[^"]*")?/g, '')
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    removeCrossOrigin(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'], // Tell Rollup that 'electron' is external
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                format: 'es',
                entryFileNames: 'preload.mjs',
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
})
