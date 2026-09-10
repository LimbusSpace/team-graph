import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/team-graph/' : '/',
  // 预览环境使用代理域名访问 dev server，允许任意 Host；生产构建不受影响。
  server: {
    allowedHosts: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['project-mark.svg'],
      manifest: {
        name: '具身项目依赖台',
        short_name: '项目依赖台',
        description: '团队共享的依赖、证据与进度审计工作台',
        theme_color: '#f4f6f2',
        background_color: '#f4f6f2',
        display: 'standalone',
        icons: [
          {
            src: '/project-mark.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/functions\//],
      },
    }),
  ],
})
