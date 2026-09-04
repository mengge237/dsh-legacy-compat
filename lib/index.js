// dsh-legacy-compat — DSH 0.1.2-rc.1 过渡期「兼容垫片 + 启动保护」
//
// 三个功能（对应 2026-09-04 事故报告的三个根因，见
// https://github.com/mengge237/dsh-incident-report-2026-09-04）：
//   ① 启动保护：坏会话日志（首帧不是 header）不再让 dsh web 起不来
//      —— 按官方同款规则扫描 sessions 并把坏文件移入隔离区（不删除）。
//   ② Session.events 旧 API 别名：rc.1 移除了 Session#events，这里给
//      Session.prototype 补回 get events()（委托 snapshotEvents()），
//      让按旧版 API 编写的第三方预设/插件无需逐个修改。
//   ③ 启动预检：Node 版本（zstd / type-stripping API）、常见配置问题提示。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

export const name = 'dsh-legacy-compat'
export const inject = ['sessionPersistence']

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}
function log(...args) {
  try { console.error('[dsh-legacy-compat]', ...args) } catch {}
}
function warn(...args) {
  try { console.error('[dsh-legacy-compat][warn]', ...args) } catch {}
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
 * 扫描一个 sessions 根目录，把「首帧损坏」的会话日志移入隔离区。
 * 返回 { scanned, quarantined, problems[] }。
 */
export function scanSessionsRoot(sessionsRoot) {
  const result = { scanned: 0, quarantined: 0, problems: [] }
  if (!sessionsRoot) return result
  if (!fs.existsSync(sessionsRoot)) return result
  const dshRoot = path.resolve(sessionsRoot, '..')
  const quar = quarantinePathFor(dshRoot)
  const sessions = []
  const walk = (dir) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'session.jsonl.zstd') sessions.push(p)
    }
  }
  walk(sessionsRoot)
  for (const file of sessions) {
    result.scanned += 1
    let buf
    try { buf = fs.readFileSync(file) } catch { continue }
    const prob = sessionLogProblem(buf)
    if (prob === null) continue
    // 移入隔离区（保留原文件字节，便于后续人工/工具恢复）
    const rel = path.relative(sessionsRoot, file).split(path.sep)
    // rel = <workspace>/<sessionId>/session.jsonl.zstd
    const ws = rel[0] ?? 'unknown'
    const sid = rel[1] ?? path.basename(path.dirname(file))
    const target = path.join(quar, ws, sid)
    try {
      fs.mkdirSync(target, { recursive: true })
      const dest = path.join(target, 'session.jsonl.zstd')
      if (fs.existsSync(dest)) fs.rmSync(dest, { force: true })
      fs.renameSync(file, dest)
      fs.writeFileSync(path.join(target, 'WHY-QUARANTINED.txt'),
        'corrupt Zstandard session log: ' + prob + '\n' +
        '(moved here by dsh-legacy-compat so dsh web can boot; original bytes preserved)\n')
      result.quarantined += 1
      result.problems.push({ file, problem: prob, quarantinedTo: dest })
    } catch (err) {
      result.problems.push({ file, problem: prob + ' (quarantine move failed: ' + err.message + ')' })
    }
  }
  return result
}

// ---------- ② Session.events 兼容别名 ----------
let eventsAliasInstalled = false
export async function installSessionEventsAlias() {
  if (eventsAliasInstalled) return true
  try {
    const mod = await import('@deepseek-ai/dsh-session')
    const Session = mod.Session
    if (!Session) { warn('cannot find Session export (skip events alias)'); return false }
    const proto = Session.prototype
    if (!('events' in proto)) {
      Object.defineProperty(proto, 'events', {
        configurable: true,
        get() {
          // rc.1+：全量日志快照（与旧版 session.events 语义一致，冻结数组只读）
          return typeof this.snapshotEvents === 'function' ? this.snapshotEvents() : []
        }
      })
      eventsAliasInstalled = true
      log('Session.events alias installed (deprecated API restored for legacy presets/plugins)')
    } else {
      eventsAliasInstalled = true
    }
    return true
  } catch (err) {
    warn('failed to install Session.events alias:', err?.message ?? err)
    return false
  }
}

// ---------- ③ 预检 ----------
export function preflight() {
  const issues = []
  const nodeOk = typeof zlib.createZstdDecompress === 'function' && typeof zlib.zstdDecompressSync === 'function'
  if (!nodeOk) issues.push('Node 过旧：缺少 node:zlib 的 createZstdDecompress/zstdDecompressSync（DSH 0.1.2-rc.1 需要 Node >= 24，建议用 E:/Program Files/nodejs）')
  const r = process.version.match(/^v(\d+)/)
  if (r && Number(r[1]) < 24 && nodeOk === false) issues.push('检测到 Node ' + process.version)
  if (issues.length) for (const it of issues) warn(it)
  else log('preflight OK (Node ' + process.version + ', zstd APIs present)')
  return issues
}

// 顶层副作用：尽早安装别名 + 预检 + 扫描（import 即生效，先于任何会话组装）
installSessionEventsAlias().catch(() => {})
preflight()
try {
  const early = scanSessionsRoot(path.join(dshHome(), 'sessions'))
  if (early.quarantined > 0) warn('启动自检：隔离 ' + early.quarantined + ' 个坏会话日志（详见 dsh-legacy-compat-quarantine）')
  else if (early.scanned > 0) log('启动自检：扫描 ' + early.scanned + ' 个会话日志，全部正常')
} catch (err) {
  warn('启动自检扫描失败:', err?.message ?? err)
}

// ---------- cordis apply ----------
export function apply(ctx) {
  // 实例化阶段再做一次（此时能拿到持久化层 root，覆盖非默认 home 场景）
  try {
    const root = ctx?.sessionPersistence?.root
    const candidates = []
    if (typeof root === 'string' && root) candidates.push(root)
    if (fs.existsSync(path.join(dshHome(), 'sessions'))) candidates.push(path.join(dshHome(), 'sessions'))
    for (const target of candidates) {
      if (!target || !fs.existsSync(target)) continue
      // root 可能是 sessions 目录本身；校验一下再扫
      if (!/session/i.test(target) && !fs.existsSync(path.join(target, 'session.jsonl.zstd'))) continue
      const r = scanSessionsRoot(target)
      if (r.quarantined > 0) warn('隔离 ' + r.quarantined + ' 个坏会话日志（共扫描 ' + r.scanned + '）')
      break
    }
  } catch (err) {
    warn('apply 阶段扫描失败:', err?.message ?? err)
  }
  installSessionEventsAlias().catch(() => {})
}
