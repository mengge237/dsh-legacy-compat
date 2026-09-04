#!/usr/bin/env node
// dsh-legacy-compat repair —— 扫描并隔离坏会话日志（独立运行，无需 GUI）
// 用法:  node bin/repair.mjs [--home <dshHome>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const argv = process.argv.slice(2)
let home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--home' && argv[i + 1]) home = path.resolve(argv[i + 1])
}
const sessionsRoot = path.join(home, 'sessions')
if (!fs.existsSync(sessionsRoot)) {
  console.error('sessions 目录不存在: ' + sessionsRoot)
  process.exit(2)
}
const quar = path.join(home, 'dsh-legacy-compat-quarantine')
function problemOf(buf) {
  const first = buf.indexOf(MAGIC)
  if (first < 0) return 'no zstd magic'
  const second = buf.indexOf(MAGIC, first + 4)
  let pt
  try { pt = zlib.zstdDecompressSync(buf.subarray(first, second < 0 ? buf.length : second)) } catch (e) { return 'first frame undecodable: ' + e.message }
  if (pt.length === 0) return 'first frame empty'
  if (pt.indexOf(10) !== pt.length - 1) return 'first frame is not exactly one header line'
  return null
}
const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name === 'session.jsonl.zstd') files.push(p)
  }
}
walk(sessionsRoot)
let ok = 0, bad = 0
for (const f of files) {
  const prob = problemOf(fs.readFileSync(f))
  if (prob === null) { ok += 1; continue }
  bad += 1
  const rel = path.relative(sessionsRoot, f).split(path.sep)
  const target = path.join(quar, rel[0] || 'unknown', rel[1] || 'unknown')
  fs.mkdirSync(target, { recursive: true })
  const dest = path.join(target, 'session.jsonl.zstd')
  if (fs.existsSync(dest)) fs.rmSync(dest, { force: true })
  fs.renameSync(f, dest)
  fs.writeFileSync(path.join(target, 'WHY-QUARANTINED.txt'),
    'corrupt Zstandard session log: ' + prob + '\n(moved by dsh-legacy-compat repair)\n')
  console.log('[repair] 隔离: ' + rel.join('/') + '  (' + prob + ')')
}
console.log('[repair] 完成: 正常 ' + ok + ' / 隔离 ' + bad + '（隔离区: ' + quar + '）')
process.exit(bad > 0 ? 1 : 0)
