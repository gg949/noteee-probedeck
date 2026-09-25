#!/usr/bin/env bash
# 把 dist/ 发布成独立的构建分支（默认 build），供 ProbeDeck 主题商店使用。
#
# 为什么需要：主题商店的版本列表由 GitHub commits?sha=<branch> 生成，
# 安装地址固定是分支根目录 /tree/<commit>，不会带 /dist 子路径。
# 所以产物必须位于构建分支的根目录。
#
# 用法：在本仓库根目录执行
#   bash scripts/publish-build-branch.sh          # 发布到 build 分支
#   bash scripts/publish-build-branch.sh v1.0.4   # 发布到 v1.0.4 分支（商店里 branch 改成同名）
set -euo pipefail

BRANCH="${1:-build}"
cd "$(dirname "$0")/.."

if [ ! -f dist/index.html ]; then
  echo "错误：dist/index.html 不存在，请先执行 npm install && npm run build" >&2
  exit 1
fi

for f in dist/assets/*; do
  [ -e "$f" ] || { echo "错误：dist/assets/ 为空，构建产物不完整" >&2; exit 1; }
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R dist/. "$TMP/"

git checkout --orphan "$BRANCH"
find . -mindepth 1 -maxdepth 1 -not -path './.git' -exec rm -rf {} +
cp -R "$TMP/." .
git add -A
git commit -m "build: publish dist as ${BRANCH} branch"
git push origin "$BRANCH"

echo "已发布构建分支：${BRANCH}"
echo "商店 themes.json 里的 branch 应为：${BRANCH}"
