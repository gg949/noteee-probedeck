import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// ProbeDeck 默认端口；PROBEDECK_URL=https://面板地址 npm run dev
const probedeck = process.env.PROBEDECK_URL || "http://127.0.0.1:17986"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": import.meta.dirname + "/src" } },
  build: { chunkSizeWarningLimit: 900, assetsDir: "assets" },
  server: { proxy: { "/api": { target: probedeck, changeOrigin: true, ws: true } } },
})
