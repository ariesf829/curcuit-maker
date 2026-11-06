import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative URLs so the build works from a GitHub Pages sub-path (/<repo>/) as well as the root.
  base: './',
  plugins: [react()],
})
