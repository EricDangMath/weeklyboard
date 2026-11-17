import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins:[react()],
  server:{
    host:'127.0.0.1',
    port:4173,
    proxy:{ '/api':'http://127.0.0.1:8787' },
    watch:{ ignored:['**/chrome-profile/**','**/chrome-profile*/**','**/*.db','**/*.log'] },
  },
});
