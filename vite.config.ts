import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 같이하기 서버(npm run server)로 웹소켓을 넘겨준다. 같은 주소 하나로 접속하게 하려는 것
    proxy: {
      '/ws': { target: 'ws://localhost:5200', ws: true, rewriteWsOrigin: true },
    },
  },
})
