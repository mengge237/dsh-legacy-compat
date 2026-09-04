// dsh-legacy-compat — DSH 0.1.2-rc.1 过渡期「兼容垫片 + 启动保护」
//
// 设计原则：
//   · 平时安静 —— 一切正常时不输出任何东西；只在「发现问题/做了隔离/安装失败」
//     时给出一行简短提示；详细日志用 DSH_LEGACY_COMPAT_VERBOSE=1 打开。
//   · 装上即用、一键卸载 —— bin/uninstall.mjs 可干净移除。
//   · 上游修复后即可卸载（报告：github.com/mengge237/dsh-incident-report-2026-09-04）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

export const name = 'dsh-legacy-compat'
export const inject = ['sessionPersistence']

const VERBOSE = process.env.DSH_LEGACY_COMPAT_VERBOSE === '1'
const TAG = 'dsh-legacy-compat'
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

// 消息出口：优先 dsh logger（能进 GUI/日志系统），否则才用 console；
// 正常情况静默，verbose 才输出 info。
function say(ctx, level, ...args) {
  const logger = ctx?.logger
  if (logger && typeof logger[level] === 'function') {
    try { logger[level](TAG, ...args); return } catch {}
  }
  if (VERBOSE || level === 'warn' || level === 'error') {
    try { console.error('[' + TAG + ']', ...args) } catch {}
  }
}

// ---------- 校验/隔离（与官方 readFirstZstdLine + assertZstdHeaderFrame 同规则） ----------
export function sessionLogProblem(buf) {
  const first = buf.indexOf(MAGIC)
  if (first < 0) return 'no zstd magic (not a session log?)'
  const second = buf.indexOf(MAGIC, first + 4)
  let plain
  try { plain = zlib.zstdDecompressSync(buf.subarray(first, second < 0 ? buf.length : second)) }
  catch (e) { return 'first zstd frame undecodable: ' + e.message }
  if (plain.length === 0) return 'first frame empty'
  if (plain.indexOf(10) !== plain.length - 1) return 'first frame is not exactly one header line'
  return null
}
export function quarantinePathFor(dshRoot) {
  return path.join(dshRoot, 'dsh-legacy-compat-quarantine')
}
/**
 * 扫描 sessions 根目录：首帧损坏的日志移入隔离区（原字节保留，不删除）。
 * 返回 { scanned, quarantined, problems[] }。
 */
export function scanSessionsRoot(sessionsRoot) {
  const result = { scanned: 0, quarantined: 0, problems: [] }
  if (!sessionsRoot || !fs.existsSync(sessionsRoot)) return result
  const dshRoot = path.resolve(sessionsRoot, '..')
  const quar = quarantinePathFor(dshRoot)
  const files = []
  const walk = (dir) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'session.jsonl.zstd') files.push(p)
    }
  }
  walk(sessionsRoot)
  for (const file of files) {
    result.scanned += 1
    let buf
    try { buf = fs.readFileSync(file) } catch { continue }
    const prob = sessionLogProblem(buf)
    if (prob === null) continue
    const rel = path.relative(sessionsRoot, file).split(path.sep)
    const ws = rel[0] || 'unknown'
    const sid = rel[1] || path.basename(path.dirname(file))
    const target = path.join(quar, ws, sid)
    try {
      fs.mkdirSync(target, { recursive: true })
      const dest = path.join(target, 'session.jsonl.zstd')
      if (fs.existsSync(dest)) fs.rmSync(dest, { force: true })
      fs.renameSync(file, dest)
      fs.writeFileSync(path.join(target, 'WHY-QUARANTINED.txt'),
        'corrupt Zstandard session log: ' + prob + '\n' +
        '(moved by dsh-legacy-compat so dsh web can boot; original bytes preserved)\n' +
        '可以放心删除，也可等上游修复后人工移回 sessions。\n')
      result.quarantined += 1
      result.problems.push({ file, problem: prob, quarantinedTo: dest })
    } catch (err) {
      result.problems.push({ file, problem: prob + ' (move failed: ' + err.message + ')' })
    }
  }
  return result
}

// ---------- ② Session.events 兼容别名（尽早、幂等） ----------
let aliasState = 'pending'
export async function installSessionEventsAlias(ctx) {
  if (aliasState === 'ok' || aliasState === 'failed') return aliasState === 'ok'
  try {
    const mod = await import('@deepseek-ai/dsh-session')
    const Session = mod && (mod.Session ?? mod.default?.Session)
    if (!Session) { aliasState = 'failed'; say(ctx, 'warn', '找不到 dsh-session 的 Session 导出，events 别名未安装'); return false }
    const proto = Session.prototype
    if (!('events' in proto)) {
      Object.defineProperty(proto, 'events', {
        configurable: true,
        get() {
          return typeof this.snapshotEvents === 'function' ? this.snapshotEvents() : []
        }
      })
    }
    aliasState = 'ok'
    say(ctx, 'info', '已就绪：Session.events 兼容别名已恢复（旧版预设/插件可直接使用）')
    return true
  } catch (err) {
    aliasState = 'failed'
    say(ctx, 'warn', 'Session.events 别名安装失败（' + (err?.message || err) + '）；详见 README 的 link 安装依赖说明')
    return false
  }
}

// ---------- ③ 预检（只在发现问题时提示） ----------
export function preflight(ctx) {
  const issues = []
  const hasZstd = typeof zlib.createZstdDecompress === 'function' && typeof zlib.zstdDecompressSync === 'function'
  if (!hasZstd) issues.push('当前 Node 过旧：缺少 zstd API（DSH 0.1.2-rc.1 需要 Node >= 24），请用新版 Node 启动')
  for (const it of issues) say(ctx, 'warn', it)
  return issues
}

// 顶层副作用：尽早安装别名（ESM 顶层 await，模块加载完成前必装好）
await installSessionEventsAlias()

// ---------- cordis apply ----------
export function apply(ctx) {
  preflight(ctx)
  try {
    const root = ctx?.sessionPersistence?.root
    const candidates = []
    if (typeof root === 'string' && root && /session/i.test(root)) candidates.push(root)
    if (fs.existsSync(path.join(dshHome(), 'sessions'))) candidates.push(path.join(dshHome(), 'sessions'))
    for (const target of candidates) {
      if (!fs.existsSync(target)) continue
      const r = scanSessionsRoot(target)
      if (r.quarantined > 0) say(ctx, 'warn', '已隔离 ' + r.quarantined + ' 个损坏会话日志（避免启动失败），原文件保留在 dsh-legacy-compat-quarantine/')
      else if (VERBOSE) say(ctx, 'info', '会话日志自检通过：' + r.scanned + ' 个正常')
      break
    }
  } catch (err) {
    say(ctx, 'warn', '启动自检扫描失败：' + (err?.message || err))
  }
  installSessionEventsAlias(ctx).catch(() => {})
}
