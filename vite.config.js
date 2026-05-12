import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, statSync, existsSync } from 'fs';

const root = __dirname;

const sceneDirs = readdirSync(root).filter((name) => {
  if (!name.startsWith('scene_')) return false;
  const full = resolve(root, name);
  return statSync(full).isDirectory() && existsSync(resolve(full, 'index.html'));
});

const input = {
  main: resolve(root, 'index.html'),
};
for (const dir of sceneDirs) {
  input[dir] = resolve(root, dir, 'index.html');
}

export default defineConfig({
  root,
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false,
    fs: {
      allow: [root, resolve(root, 'data')],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: { input },
  },
});
