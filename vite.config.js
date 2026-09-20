/**
 * vite.config.js - Vite 构建配置
 *
 * 功能: 定义开发服务器与生产构建行为。
 *   - dev / build / preview 共用项目根目录的 index.html;
 *   - 运行时通过 fetch 加载的 data/ 目录(非模块图依赖)在构建时复制到 dist/;
 *   - dev / preview 均把 /api 代理到本地后端,使前端始终以同源相对路径请求;
 *   - 构建产物输出到 dist/,该目录不提交到仓库(.gitignore)。
 */
import { defineConfig } from "vite";
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 本地后端地址,dev 与 preview 共用同一目标 */
const API_TARGET = "http://127.0.0.1:8010";

/** 把 /api 转发到本地 FastAPI,避免开发期跨域与前端硬编码 host */
const apiProxy = {
  "/api": {
    target: API_TARGET,
    changeOrigin: true,
  },
};

/** 构建结束时把 data/ 复制到 dist/data/,保证运行时 fetch("./data/...") 可用 */
const copyData = () => ({
  name: "copy-data",
  closeBundle() {
    const src = fileURLToPath(new URL("./data", import.meta.url));
    const dest = fileURLToPath(new URL("./dist/data", import.meta.url));
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true });
    }
  },
});

export default defineConfig({
  plugins: [copyData()],
  server: {
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
  build: {
    outDir: "dist",
  },
});
