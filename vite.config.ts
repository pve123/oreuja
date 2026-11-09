import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * 링크 미리보기(카카오톡·슬랙 등)의 그림과 주소. og:image 는 절대 주소여야 해서 빌드할 때 사이트 주소를 알아야 넣을 수 있다.
 * SITE_URL 을 주면 그 주소를, 없으면 Vercel 이 빌드 중에 알려 주는 운영 주소(VERCEL_PROJECT_PRODUCTION_URL)를 쓴다.
 * 둘 다 없으면(로컬 빌드) 넣지 않는다. 그림은 public/og-image.jpg (1200x630)
 */
function socialMeta(): Plugin {
  return {
    name: 'social-meta',
    transformIndexHtml() {
      const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
      const site = (process.env.SITE_URL ?? (vercel ? `https://${vercel}` : '')).replace(/\/$/, '')
      if (!site) return
      const meta = (attrs: Record<string, string>) => ({ tag: 'meta', attrs, injectTo: 'head' as const })
      return [
        meta({ property: 'og:url', content: `${site}/` }),
        meta({ property: 'og:image', content: `${site}/og-image.jpg` }),
        meta({ property: 'og:image:width', content: '1200' }),
        meta({ property: 'og:image:height', content: '630' }),
        meta({ property: 'og:image:alt', content: '북한산 백운대 정상에서 만세를 부르는 등산객과 「정상이다」 말풍선' }),
        meta({ name: 'twitter:card', content: 'summary_large_image' }),
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), socialMeta()],
  build: {
    // 물리 엔진(WASM 을 품은 Rapier)이 한 덩어리로 1MB 가 넘는다
    chunkSizeWarningLimit: 2400,
    rolldownOptions: {
      output: {
        // 라이브러리를 묶음별로 나눠 브라우저가 동시에 받고, 앱 코드만 바뀐 배포에서는 라이브러리를 캐시에서 다시 쓰게 한다
        codeSplitting: {
          // 묶음마다 자기 라이브러리만 담는다 (기본값은 의존하는 three 까지 끌어와 물리 묶음이 커진다)
          includeDependenciesRecursively: false,
          groups: [
            { name: 'physics', test: /node_modules[\\/](@dimforge|@react-three[\\/]rapier)[\\/]/ },
            { name: 'postfx', test: /node_modules[\\/](postprocessing|n8ao|@react-three[\\/]postprocessing)[\\/]/ },
            { name: 'three', test: /node_modules[\\/](three|three-stdlib)[\\/]/ },
            { name: 'react', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    // 같이하기 서버(npm run server)로 웹소켓을 넘겨준다. 같은 주소 하나로 접속하게 하려는 것
    proxy: {
      '/ws': { target: 'ws://localhost:5200', ws: true, rewriteWsOrigin: true },
    },
  },
})
