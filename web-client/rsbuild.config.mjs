import { defineConfig } from '@rsbuild/core'
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill'

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  source: {
    entry: { index: './src/index.js' },
  },
  html: {
    template: './src/index.html',
  },
  output: {
    distPath: {
      root: 'dist',
    },
    externals: [],
    copy: [
      {
        from: path.resolve(__dirname, 'node_modules/minecraft-renderer/dist/mesherWasm.js'),
        to: 'mesherWasm.js',
      },
      {
        from: path.resolve(__dirname, 'node_modules/minecraft-renderer/dist/mesher.js'),
        to: 'mesher.js',
      },
      {
        from: path.resolve(__dirname, 'node_modules/minecraft-renderer/dist/threeWorker.js'),
        to: 'threeWorker.js',
      },
    ],
  },
  plugins: [pluginNodePolyfill()],
})
