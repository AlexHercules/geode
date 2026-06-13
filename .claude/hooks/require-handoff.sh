#!/usr/bin/env bash
# Stop hook：每轮收尾强制写文档，闭合「读 handoff → 开发 → 写 handoff」循环。
# 触发：Claude 结束响应（停下等用户）时。decision=block 会让 Claude 继续干完收尾再停。
# 拦截当：
#   A. src/ 或 docs/ 有未提交改动（活没收尾）；或
#   B. 自上次更新 docs/HANDOFF.md 后又提交过 src/（代码变了文档没跟 → 下次续接读到过时状态）。
# gate 在可清除的真实条件上：提交代码 + 更新 HANDOFF 并提交后放行，不会死循环。
set -uo pipefail
INPUT="$(cat)"
PROJ="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("cwd","") or "")
except Exception: print("")' 2>/dev/null)}"
cd "$PROJ" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0   # 非 git 仓库：放行

block() {
  python3 -c 'import json,sys;print(json.dumps({"decision":"block","reason":sys.argv[1]}))' "$1"
  exit 0
}

# A. src/ docs/ 有未提交改动（tracked 改动 + 未忽略的 untracked）
DIRTY="$(git status --porcelain -- src docs 2>/dev/null)"
if [ -n "$DIRTY" ]; then
  block "🔁 本轮未收尾：src/ 或 docs/ 有未提交改动。按 /continue Step 6 收尾——刷新 docs/HANDOFF.md 顶部 START HERE 状态、写 ROADMAP / ARCHITECTURE As-built，feat/docs(rXX): 提交并 git push 后再结束。未提交：
${DIRTY}"
fi

# B. 自上次写 HANDOFF 后又提交过 src/ → 文档落后于代码
LAST_HANDOFF="$(git log -1 --format=%H -- docs/HANDOFF.md 2>/dev/null)"
if [ -n "$LAST_HANDOFF" ]; then
  SRC_SINCE="$(git log --oneline "${LAST_HANDOFF}..HEAD" -- src 2>/dev/null | head -3)"
  if [ -n "$SRC_SINCE" ]; then
    block "🔁 代码已变但 HANDOFF 未更新：自上次写 docs/HANDOFF.md 后又提交了 src/。先刷新 HANDOFF 顶部 START HERE 状态区 + 追加本轮根因教训并提交，再结束（下次「阅读 handoff，继续开发」才能续上）。相关提交：
${SRC_SINCE}"
  fi
fi

exit 0   # 收尾完整，放行
