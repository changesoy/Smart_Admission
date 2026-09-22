# dev.ps1 - 一键启动本地开发环境(后端 FastAPI 8010 + 前端 Vite 5173)
#
# 用法: npm run dev:all
#
# 行为:
#   1. 检查 .venv / .env / 天地图服务端 Key, 缺失时给出明确提示(不静默跳过);
#   2. 在独立窗口启动 uvicorn(--reload), 当前窗口启动 Vite;
#   3. Vite 退出(Ctrl+C)后, 独立窗口中的后端仍会继续运行, 需手动关闭。

$ErrorActionPreference = "Stop"

# 项目根目录 = 脚本所在目录的上一级
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$python = Join-Path $root ".venv\Scripts\python.exe"
$envFile = Join-Path $root ".env"

# --- 环境检查: 虚拟环境 ---
if (-not (Test-Path $python)) {
  Write-Host "[错误] 未找到虚拟环境: $python" -ForegroundColor Red
  Write-Host "       请先创建并安装后端依赖:" -ForegroundColor Yellow
  Write-Host "         python -m venv .venv"
  Write-Host "         .venv\Scripts\python.exe -m pip install -r server\requirements.txt"
  exit 1
}

# --- 环境检查: 服务端 Key ---
if (-not (Test-Path $envFile)) {
  Write-Host "[警告] 未找到 .env, 后端将使用默认配置。" -ForegroundColor Yellow
  Write-Host "       联网搜索需要天地图服务端 Key, 请先执行: copy .env.example .env"
} else {
  $line = Select-String -Path $envFile -Pattern '^\s*TIANDITU_SEARCH_TK\s*=\s*(\S+)' |
    Select-Object -First 1
  $tk = if ($line) { $line.Matches[0].Groups[1].Value } else { "" }
  if (-not $tk) {
    Write-Host "[警告] .env 中 TIANDITU_SEARCH_TK 为空, 联网搜索会返回 TOKEN_MISSING。" -ForegroundColor Yellow
    Write-Host "       本地数据功能不受影响, 仅'本地无匹配时的联网搜索'不可用。"
  }
}

# --- 启动后端(独立窗口, 便于单独查看日志) ---
Write-Host "[1/2] 启动后端: http://127.0.0.1:8010" -ForegroundColor Cyan
Start-Process -FilePath $python `
  -ArgumentList "-m", "uvicorn", "server.app:app", "--port", "8010", "--reload" `
  -WorkingDirectory $root

# --- 启动前端(当前窗口, Ctrl+C 结束) ---
Write-Host "[2/2] 启动前端: http://localhost:5173" -ForegroundColor Cyan
npm run dev
