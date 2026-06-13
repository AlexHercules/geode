#!/usr/bin/env bash
# Geode PreToolUse 守卫（matcher: Bash）
# 自主开发模式的「机械强制」闸门——在每条 Bash 命令执行【之前】运行：
#   1) 安全闸：拦截不可逆 / 外向 / 毁数据动作（对应 CLAUDE.md §自主开发契约 的硬边界）
#   2) 质量闸：git commit 前强制 `npm run typecheck`，不过则拒绝提交（四条底线之「构建常绿」）
# 机制：从 stdin 读 Claude Code 传入的 JSON，命中规则就输出 permissionDecision=deny（exit 0），
#       Claude Code 据此【拦掉这次工具调用】，并把 reason 回喂给 Claude。
# 用 JSON deny 而非 `exit 2`：PreToolUse 下 exit 2 可能让 Claude 直接停（已知 issue），deny 更稳。
set -uo pipefail

INPUT="$(cat)"

# --- 解析 stdin（python3 为 macOS 自带；解析失败一律放行，绝不因守卫自身故障卡住开发）---
CMD="$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("tool_input",{}).get("command","") or "")
except Exception: print("")' 2>/dev/null)"
PROJ="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$INPUT" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("cwd","") or "")
except Exception: print("")' 2>/dev/null)}"

[ -z "$CMD" ] && exit 0   # 非命令型调用，放行

# deny <reason>：输出 PreToolUse deny JSON 并结束（exit 0，由 stdout JSON 决定拦截）
deny() {
  python3 -c 'import json,sys
print(json.dumps({"hookSpecificOutput":{
  "hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.argv[1]}}))' "$1"
  exit 0
}

# ============ 安全闸：硬边界（不可逆 / 外向 / 毁数据）============
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+push([[:space:]].*)?(--force|[[:space:]]-f([[:space:]]|$))'; then
  deny "🛑 硬边界：禁止 force push（改写远端历史不可逆）。确需推送请人工执行。见 CLAUDE.md §自主开发契约。"
fi
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+(filter-branch|push[[:space:]].*--delete|push[[:space:]]+[^[:space:]]+[[:space:]]+:)'; then
  deny "🛑 硬边界：禁止改写历史 / 删除远端分支。"
fi
if printf '%s' "$CMD" | grep -qE '\.tauri-keys'; then
  deny "🛑 硬边界：禁止访问 .tauri-keys（更新签名私钥，且未找回）。签名/发布须用户确认后人工执行。"
fi
if printf '%s' "$CMD" | grep -qE '(tauri[[:space:]]+signer|minisign|tauri[[:space:]]+build([[:space:]].*)?--sign|npm[[:space:]]+publish)'; then
  deny "🛑 硬边界：签名 / 发布属不可逆外向动作，须用户确认后人工执行。"
fi

# ============ 质量闸：commit 前 typecheck 必过（构建常绿）============
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+commit'; then
  if command -v npm >/dev/null 2>&1; then
    OUT="$( cd "$PROJ" 2>/dev/null && npm run -s typecheck 2>&1 )"
    if [ $? -ne 0 ]; then
      TAIL="$(printf '%s' "$OUT" | tail -n 30)"
      deny "🚧 构建常绿底线：typecheck 未通过，提交已拦下。先修这些 TS 错误再 commit（不要用 any/@ts-ignore 绕过）：
${TAIL}"
    fi
  else
    # node/npm 不在非交互 PATH（如 nvm 未 source）：警告但放行，避免完全无法提交。
    # 见 .calibration/README.md「让质量闸在你的 shell 里生效」。
    printf 'guard-bash: ⚠ 找不到 npm，已跳过 typecheck 质量闸（非交互 shell PATH 缺 node?）。\n' >&2
  fi
fi

exit 0   # 默认放行
