import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: GitHub Pages는 '/<레포 이름>/' 하위 경로에서 서비스되므로 빌드 때 VITE_BASE로 지정한다(기본 '/').
// 개발 중에는 /api 요청을 Flask(5000)로 넘긴다(Docker/ECS 버전의 상태 정보용, 없어도 앱은 동작).
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:5000' } },
})
