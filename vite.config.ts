import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
