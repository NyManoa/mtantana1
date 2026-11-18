import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * Content-Security-Policy injectée uniquement dans le build de production
 * (le serveur de dev de Vite a besoin de scripts inline pour le rechargement à chaud).
 * Seuls Supabase et Google (connexion + Drive) sont autorisés.
 */
function cspPlugin(supabaseUrl: string): Plugin {
  let supabaseOrigin = 'https://*.supabase.co';
  try {
    if (supabaseUrl) supabaseOrigin = new URL(supabaseUrl).origin;
  } catch {
    /* garde la valeur par défaut */
  }
  const wsOrigin = supabaseOrigin.replace(/^http/, 'ws');
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${supabaseOrigin} ${wsOrigin} https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com`,
    'frame-src https://accounts.google.com',
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'mtantana-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      cspPlugin(env.VITE_SUPABASE_URL ?? ''),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/functions\//, /^\/auth\//, /^\/rest\//],
          cleanupOutdatedCaches: true,
        },
        manifest: {
          name: "M'tantana",
          short_name: "M'tantana",
          description: 'Gestion de budget en Ariary — fonctionne hors ligne',
          theme_color: '#0a0f1c',
          background_color: '#0a0f1c',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          lang: 'fr',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            dexie: ['dexie'],
          },
        },
      },
    },
    optimizeDeps: {
      include: ['lucide-react'],
    },
  };
});
