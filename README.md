# dsh-legacy-compat

DSH 0.1.2-rc.1 过渡期的「兼容垫片 + 启动保护」插件。
设计原则：**装上即用、平时安静、一键卸载**；上游修复后即可移除。
起因与根因分析见 https://github.com/mengge237/dsh-incident-report-2026-09-04

## 功能

1. **启动保护**：按官方同款规则校验 `sessions/**/session.jsonl.zstd` 首个 zstd 帧；
   遇到「首帧不是恰好一行 header」的坏日志，自动移入 `~/.dsh/dsh-legacy-compat-quarantine/`
   （原字节保留、不删除），避免 `dsh web` 因一个坏日志起不来。
2. **Session.events 兼容别名**：给 `Session.prototype` 补回 `get events()`（委托新版 `snapshotEvents()`），
   按旧 API 写的第三方预设/插件（如 `session.events.length` 这类用法）无需修改即可运行。
3. **启动预检**：Node 版本 / zstd API 检查（rc.1 需要 Node >= 24）。

## 安装

```bash
# 方式 A：本地源码（本仓库）
dsh plugin --profile web add link:E:/S_Software/deepseek-harness/plugins/dsh-legacy-compat
# 方式 B：以后发布到 npm 后
# dsh plugin --profile web add dsh-legacy-compat

# 完全重启 dsh web
```

任意 profile 均可（web / tui / headless / 自定义）。

## 一键卸载（过渡期专用）

```bash
node bin/uninstall.mjs                 # 卸载 web profile 中的本插件
node bin/uninstall.mjs --profile tui   # 指定其它 profile
node bin/uninstall.mjs --dry-run       # 只预览不改动
```

脚本会：从 `dsh.profile.bundles` 移除、删除 `dependencies` 里的 link 记录、删除 `node_modules` 链接，
并自动备份修改前的 `package.json`（`.bak-uninstall-<时间戳>`，可回退）。**卸载后完全重启一次**即回到未安装状态；
隔离区数据不会被动，可自行决定保留或删除。

## 日志与“安静模式”

- 一切正常时**不输出任何内容**，不打扰使用；
- 仅在「隔离了坏日志 / 别名安装失败 / Node 版本不兼容」时给出一行简短警告；
- 想看详情：设置环境变量后重启：`DSH_LEGACY_COMPAT_VERBOSE=1`；
- 输出优先走 dsh 自身的 logger，其次才用终端 console。

## 离线修复（dsh web 已经起不来的情况）

```bash
node bin/repair.mjs                      # 扫描并把坏会话日志移入隔离区
node bin/repair.mjs --home <dshHome>     # 指定自定义 home
```

## 本地 link 安装的依赖解析

别名功能需要 import `@deepseek-ai/dsh-session`。
- **npm/registry 安装**：依赖随包安装，无需处理；
- **本地 link 安装**：本仓库源码目录已自带
  `node_modules/@deepseek-ai/dsh-session`（junction，指向你机器上 harness 的 dsh-session 包）；
  换机器/从 zip 分发时重建即可：

```powershell
New-Item -ItemType Junction -Path node_modules/@deepseek-ai/dsh-session -Target <dsh安装路径>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session
```

## 边界与建议

- 这是**过渡垫片**；真正修复请跟踪上游：
  https://github.com/deepseek-ai/deepseek-harness/discussions/5655 、
  https://github.com/zhu1090093659/dsh-web/issues/1376 。
- 隔离区日志是保留不是删除；上游修复后确认无坏日志即可清理。
- 卸载脚本不影响你在 `E:\S_Software\deepseek-harness\plugins\dsh-legacy-compat` 的源码，之后想再启用重新 link 即可。
