import { mergeConfig } from 'vite';
import base from './vite.config.js';

// 独立实例:前端 3001,API 代理到自己的后端 3007
export default mergeConfig(base, {
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:3007',
        changeOrigin: true,
      },
    },
  },
});
