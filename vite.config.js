/**
 * vite.config.js - Vite 构建配置
 *
 * 功能: 定义开发服务器与生产构建行为。
 *   - dev / build / preview 共用项目根目录的 index.html;
 *   - 运行时通过 fetch 加载的 data/ 目录(非模块图依赖)在构建时复制到 dist/;
 *   - 构建产物输出到 dist/,该目录不提交到仓库(.gitignore)。
 */
import { defineConfig } from "vite";
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  build: {
    outDir: "dist",
  },
});
