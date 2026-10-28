#!/usr/bin/env bash
# pack 安装冒烟编排（工票 12 CI 腿二，对位 go GOWORK=off 消费腿）：三 tarball 装进
# 独立临时目录后按安装面渲染冒烟。只做编排、不做断言（断言在 pack-smoke.mjs），
# 对位 go Makefile「复合目标只做编排」纪律。
#
# 用法：bash scripts/ci/pack-smoke.sh [pack 输出目录]
#   缺省 $RUNNER_TEMP/pack-output（GitHub runner 现成临时盘）；本机调试可自传。
# 前置：pnpm install + pnpm -r build 已跑（pack 需要 dist）；三包 tarball 已
#   pack 到输出目录（hankchen-canvas-*.tgz）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACK_DIR="${1:-${RUNNER_TEMP:-$(mktemp -d)}/pack-output}"

ls "$PACK_DIR"/*.tgz >/dev/null || { echo "pack 目录无 tarball: $PACK_DIR" >&2; exit 1; }

# 独立临时目录（mktemp 保证并行抖动安全）；smoke 脚本必须拷入同目录运行——ESM
# 裸说明符按脚本文件位置解析，原地运行会错误命中 workspace 依赖
SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/js-canvas-pack-smoke-XXXXXX")"
trap 'rm -rf "$SMOKE_DIR"' EXIT

cat > "$SMOKE_DIR/package.json" <<'JSON'
{
    "name": "js-canvas-pack-smoke",
    "private": true,
    "type": "module"
}
JSON
cp "$REPO_ROOT/scripts/ci/pack-smoke.mjs" "$SMOKE_DIR/pack-smoke.mjs"
cd "$SMOKE_DIR"

# 三 tarball 同一条 install 命令入树：两后端的 @hankchen/canvas 依赖（pack 时已把
# workspace:* 重写为实际版本，新契约面尚未发布 registry）由同树 tarball 满足，
# 其余传递依赖（@napi-rs/canvas、pdfkit、qrcode）走 registry——真实消费方解析面
echo "npm install ← $PACK_DIR"
npm install --no-audit --no-fund --loglevel=error "$PACK_DIR"/*.tgz

node pack-smoke.mjs
