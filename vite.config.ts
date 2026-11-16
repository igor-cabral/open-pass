import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deploy: Cloudflare Worker (assets estáticos, ver wrangler.jsonc) em openpass.igorcabral.dev.br,
// servido na raiz — base '/'. Só defina VITE_BASE se hospedar numa subpasta.
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE || '/',
  resolve: {
    // BUGFIX: o projeto usa o atalho de import "@/..." (definido em tsconfig.json
    // como "@/*": ["src/*"]) em todos os arquivos. O TypeScript já sabia traduzir
    // isso, mas o Vite/Rollup (quem realmente empacota o build) nunca tinha essa
    // mesma regra — por isso "tsc -b" passava e "vite build" quebrava logo na
    // primeira importação com "@/". Este alias resolve os dois lados igual.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'brand/openpass-logo.png', 'brand/igorcabral-claro.png', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'OpenPass — Ingressos digitais',
        short_name: 'OpenPass',
        description: 'Venda, emissão e validação de ingressos digitais para eventos',
        theme_color: '#0466FC',
        background_color: '#F6F8FB',
        display: 'standalone',
        start_url: process.env.VITE_BASE || '/',
        scope: process.env.VITE_BASE || '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Never cache Supabase API/auth calls -- validation must always hit the network.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: mode !== 'production',
  },
}))
