import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Portas configuráveis para conviver com outros projetos rodando na máquina.
  server: {
    // 5273/3101 e não 5173/3001: as portas padrão do Vite/Express já são usadas por
    // outro projeto interno na máquina de dev.
    port: Number(process.env.VITE_PORT || 5273),
    strictPort: true,
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://localhost:3101',
    },
    // .cache guarda o banco do dev e os dumps da planilha; observar isso derruba o
    // watcher com EBUSY em arquivos que o Postgres/WASM mantém abertos.
    watch: { ignored: ['**/.cache/**', '**/dist/**'] },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
