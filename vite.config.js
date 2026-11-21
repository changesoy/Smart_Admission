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
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createReport } from "./scripts/lib/network-schema.mjs";
import { indexFeatures } from "./scripts/lib/network-generator-core.mjs";
import { validateCandidateReview } from "./scripts/lib/candidate-review.mjs";

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

const zoneDraftImport = () => ({
  name: "zone-draft-import",
  apply: "serve",
  configureServer(server) {
    const root = fileURLToPath(new URL("./", import.meta.url));

    server.middlewares.use("/__tools/import-draft", (req, res) => {
      const reply = (status, payload) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(payload));
      };

      if (req.method !== "POST") {
        reply(405, { ok: false, error: "只接受 POST" });
        return;
      }

      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 8 * 1024 * 1024) chunks.push(chunk);
      });
      req.on("end", () => {
        if (size > 8 * 1024 * 1024) {
          reply(413, { ok: false, error: "草稿超过 8 MB，拒绝处理" });
          return;
        }

        let payload;
        try {
          const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
          payload = JSON.parse(text);
        } catch {
          reply(400, { ok: false, error: "请求体不是合法 JSON" });
          return;
        }

        const draft = payload?.draft;
        const confirm = payload?.confirm;
        if (!draft?.draftId || draft.draftId !== confirm) {
          reply(400, { ok: false, error: "confirm 必须等于草稿 draftId" });
          return;
        }
        if (draft.status !== "readyForReview") {
          reply(400, { ok: false, error: `只有 readyForReview 可写入，当前为 ${draft.status}` });
          return;
        }

        const tmp = mkdtempSync(join(tmpdir(), "zone-draft-"));
        try {
          const draftPath = join(tmp, "draft.json");
          const reportPath = join(tmp, "report.json");
          writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

          const result = spawnSync(
            process.execPath,
            [
              "scripts/import-zone-draft.mjs",
              draftPath,
              "--write",
              "--confirm",
              confirm,
              "--report",
              reportPath,
            ],
            { cwd: root, encoding: "utf8" },
          );
          const report = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : null;

          reply(result.status === 0 ? 200 : 409, {
            ok: result.status === 0,
            code: result.status,
            stdout: result.stdout?.trim() ?? "",
            stderr: result.stderr?.trim() ?? "",
            report,
          });
        } catch (error) {
          reply(500, { ok: false, error: error.message });
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      });
    });
  },
});

const candidateReviewSave = () => ({
  name: "candidate-review-save",
  apply: "serve",
  configureServer(server) {
    const root = fileURLToPath(new URL("./", import.meta.url));

    server.middlewares.use("/__tools/save-candidate-review", (req, res) => {
      const reply = (status, payload) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(payload));
      };

      if (req.method !== "POST") {
        reply(405, { ok: false, error: "只接受 POST" });
        return;
      }

      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 8 * 1024 * 1024) chunks.push(chunk);
      });
      req.on("end", () => {
        if (size > 8 * 1024 * 1024) {
          reply(413, { ok: false, error: "审核文档超过 8 MB，拒绝处理" });
          return;
        }

        let payload;
        try {
          const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
          payload = JSON.parse(text);
        } catch {
          reply(400, { ok: false, error: "请求体不是合法 JSON" });
          return;
        }

        const review = payload?.review;
        const confirm = payload?.confirm;
        if (!review?.reviewId || review.reviewId !== confirm) {
          reply(400, { ok: false, error: "confirm 必须等于审核文档 reviewId" });
          return;
        }

        try {
          const features = JSON.parse(
            readFileSync(join(root, "data/boundary_features.v2.geojson"), "utf8"),
          );
          const registry = JSON.parse(
            readFileSync(join(root, "data/id_registry.json"), "utf8"),
          );
          const report = createReport();
          const featureIndex = indexFeatures(features, createReport());
          const normalized = validateCandidateReview({
            review,
            registry,
            featureIndex,
            report,
          });

          if (!normalized || report.errors.length > 0) {
            reply(409, {
              ok: false,
              errors: report.errors,
              warnings: report.warnings,
            });
            return;
          }

          const target = join(
            root,
            "reports/network/connection-candidates.reviewed.json",
          );
          mkdirSync(join(root, "reports/network"), { recursive: true });
          writeFileSync(target, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

          reply(200, {
            ok: true,
            path: "reports/network/connection-candidates.reviewed.json",
            counts: normalized.counts,
            warnings: report.warnings,
          });
        } catch (error) {
          reply(500, { ok: false, error: error.message });
        }
      });
    });
  },
});

export default defineConfig({
  plugins: [copyData(), zoneDraftImport(), candidateReviewSave()],
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
