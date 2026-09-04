# dsh-legacy-compat

DSH 0.1.2-rc.1 过渡期的「兼容垫片 + 启动保护」插件。
起因与根因分析见 https://github.com/mengge237/dsh-incident-report-2026-09-04

## 功能

1. **启动保护（根因 A）**：按官方同款规则校验 `sessions/**/session.jsonl.zstd` 首个 zstd 帧；
   遇到「首帧不是恰好一行 header」的坏日志，自动移入
   `~/.dsh/dsh-legacy-compat-quarantine/`（原字节保留，不删除），避免
   `corrupt Zstandard session log: first frame is not exactly one header line`
   让整个 `dsh web` 起不来。
2. **Session.events 兼容别名（根因 C）**：给 `Session.prototype` 补回 `get events()`
   （委托新版 `snapshotEvents()`）。按旧 API 写的第三方 agent 预设/插件
   （如 `session.events.length` 这类用法）无需修改即可在新版运行。
3. **启动预检**：Node 版本 / zstd API 检查并给出清晰提示（rc.1 需要 Node >= 24）。

## 安装

```bash
dsh plugin --profile web add link:E:/S_Software/deepseek-harness/plugins/dsh-legacy-compat
# 完全重启 dsh web
```

任意 profile 均可（web / tui / headless / 自定义）。

## 离线修复（dsh web 已经起不来的情况）

```bash
node E:/S_Software/deepseek-harness/plugins/dsh-legacy-compat/bin/repair.mjs
# 指定自定义 home： node bin/repair.mjs --home <dshHome>
```

## 本地 link 安装的依赖解析

本插件的 `Session.events` 别名需要 import `@deepseek-ai/dsh-session`。
- **npm/registry 安装**（`dsh plugin add dsh-legacy-compat`）：依赖随包安装，无需额外处理。
- **本地 link 安装**：请保证插件目录能解析该包（本仓库源码目录已自带
  `node_modules/@deepseek-ai/dsh-session` 指向 harness 安装的 junction；
  从仓库下载后如需本地 link 使用，请重建该链接）：
  ```powershell
  New-Item -ItemType Junction -Path node_modules/@deepseek-ai/dsh-session ^
    -Target <dsh 安装路径>/node_modules/@deepseek-ai/dsh-session
  ```

## 边界与建议

- 这是**过渡垫片**：真正修复需要上游（已反馈：
  https://github.com/deepseek-ai/deepseek-harness/discussions/5655 ，
  https://github.com/zhu1090093659/dsh-web/issues/1376 ）。
- 隔离区里的日志是**保留**的（不是删除），上游修复后或需要时可人工移回。
- 坏日志的“根治”建议：官方扫描时对坏首帧文件跳过+隔离+报告，而不是整树失败。
