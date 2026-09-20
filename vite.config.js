/**
 * vite.config.js - Vite 构建配置
 *
 * 功能: 定义开发服务器与生产构建行为。
 *   - dev / build / preview 共用项目根目录的 index.html;
 *   - 运行时通过 fetch 加载的 data/ 目录(非模块图依赖)在构建时复制到 dist/;
 *   - dev / preview 均把 /api 代理到本地后端,使前端始终以同源相对路径请求;
 *   - 构建产物输出到 dist/,该目录不提交到仓库(.gitignore)。
 *
 * 生产数据复制: 前端运行时先读 ./data/current.json 拿到版本号, 再从
 * ./data/releases/<version>/ 加载数据, 因此 build 只复制 current.json 与
 * 当前 release 目录, 不复制工作副本数据文件与历史 release。
 */
import { defineConfig } from "vite";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/** 生产数据复制: 只把当前数据 release 放入 dist/data/,其余一律不复制 */
const copyData = () => ({
  name: "copy-data",
  closeBundle() {
    const dataDir = fileURLToPath(new URL("./data", import.meta.url));
    const releasesDir = join(dataDir, "releases");
    const destDataDir = fileURLToPath(new URL("./dist/data", import.meta.url));

    // 1. 读取版本指针; 读不到或非合法 JSON 直接让 build 失败
    const pointerPath = join(dataDir, "current.json");
    let pointer;
    try {
      pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
    } catch (err) {
      throw new Error(
        `copy-data: 读取 ${pointerPath} 失败,无法确定当前数据版本: ${err.message}`,
      );
    }
    const version =
      pointer && typeof pointer.version === "string" ? pointer.version.trim() : "";
    if (!version) {
      throw new Error(
        "copy-data: data/current.json 缺少 version 字段,拒绝生成不完整生产包",
      );
    }

    // 2. 校验当前 release 目录存在, 不存在不允许静默构建
    const releaseDir = join(releasesDir, version);
    if (!existsSync(releaseDir)) {
      throw new Error(`copy-data: 当前数据版本目录不存在: ${releaseDir}`);
    }

    // 3. 只复制 current.json + 当前 release 目录(Vite 默认清空 outDir,
    //    因此 dist/data 里不会残留历史版本)
    mkdirSync(join(destDataDir, "releases"), { recursive: true });
    cpSync(pointerPath, join(destDataDir, "current.json"));
    cpSync(releaseDir, join(destDataDir, "releases", version), { recursive: true });
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
