# 兼容覆盖说明（COVERAGE）

> 一句话：**能覆盖的是“已知的三类崩点 + 所有写 `session.events` 的旧代码”；未知的新崩点无法预判，需要反馈补丁。**

## 覆盖矩阵

| 场景 | 状态 | 机制 | 覆盖范围 |
|---|---|---|---|
| 会话日志首帧损坏导致 `dsh web` 起不来 | ✅ 覆盖 | 启动自检：坏文件移入 `~/.dsh/dsh-legacy-compat-quarantine/`（不删除）；另有离线 `bin/repair.mjs` | 任意 profile、任意数量坏日志；两个入口（自检 + 离线修复）都提供 |
| 旧代码读 `session.events`（如 `session.events.length`、`session.events[...]`、遍历） | ✅ 覆盖 | `Session.prototype.events` 别名（委托 `snapshotEvents()`） | **凡是写 `session.events` 的预设/插件全部覆盖**，无需改源码 |
| Node 版本过旧（zstd / type-stripping API 缺失） | ✅ 提示 | 启动预检给出一行明确错误 | 所有环境 |
| 其它 rc.1 变更 API（`session.header`、`session.baseSeq`、工具执行类等） | ⚠️ 有限 | 空安全写法不崩；非空安全可能行为差异 | 无法穷举——遇报错请带堆栈反馈，我们补进垫片 |

## “能覆盖多少”怎么量化

跑一次兼容扫描器，看你机器上的预设/插件命中情况：

```bash
node bin/check-compat.mjs
# 也扫你的插件开发目录：
# node bin/check-compat.mjs --plugins E:/S_Software/deepseek-harness/plugins
```

输出示例（2026-09-04 本机实测）：

```text
扫描文件数: 32 | 命中旧 API: 2（可被垫片覆盖 2 / 需关注 0）
[✓ 覆盖] ~/.dsh/.agent-presets/liangshen/tool-bootstrap.mjs:345 — session.events
[✓ 覆盖] ~/.dsh/.agent-presets/liangshen/tool-bootstrap.mjs:349 — .events.length
```

## 边界（诚实说明）

- 垫片只针对**已经确认的 rc.1 破坏性变更**做兼容；无法覆盖未知的未来变更；
- `session.events` 别名返回**冻结快照**（新版 `snapshotEvents()`）；对只读用法与旧版一致，但同一数组引用每次读取可能不同——正常遍历/取长不影响；
- 它是**过渡垫片**：上游修复后（见 Discussion #5655 / Issue #1376）即可卸载，`bin/uninstall.mjs` 一条命令。

## 遇到没覆盖到的崩溃怎么办

1. 把 `dsh web` 终端里带 `at ...` 的完整堆栈发到仓库 Issues：https://github.com/mengge237/dsh-legacy-compat/issues
2. 或回帖到上游：https://github.com/deepseek-ai/deepseek-harness/discussions/5655
3. 确认后会把新兼容点加进垫片（欢迎 PR）。
