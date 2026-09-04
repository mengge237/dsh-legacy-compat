#!/usr/bin/env node
// dsh-legacy-compat check —— 扫描哪些预设/插件引用了 rc.1 已移除的旧 Session API，
// 判断本垫片能否覆盖。
// 用法: node bin/check-compat.mjs [--home <dshHome>] [--plugins <dir>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
let home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
let extraDirs = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--home' && argv[i + 1]) home = path.resolve(argv[i + 1])
  else if (argv[i] === '--plugins' && argv[i + 1]) extraDirs.push(path.resolve(argv[i + 1]));
}

// 已移除/变更的旧 API → 垫片覆盖状态
// covered: 别名已提供（装了本插件就不会崩）;
// watch: 新版仍在但语义/成员变化，空安全写法一般不会崩，仅提示关注
const RULES = [
  { re: /session\.events\b/g, label: 'session.events（旧日志数组）', status: 'covered' },
  { re: /\bevents\.length\b/g, label: '.events.length 类读取', status: 'covered' }
];
const WATCH = [
  { re: /session\.header\b/g, label: 'session.header（新版为 requestHeader，旧写法取不到）' },
  { re: /session\.baseSeq\b/g, label: 'session.baseSeq（新版已移除）' },
  { re: /\.nextTurn\.length|nextStep\.length/g, label: 'inbox.nextTurn/nextStep（内部成员，可能被插件误用）' }
];

function scanFile(file, hits) {
  let text;
  try { text = fs.readFileSync(file, 'utf8') } catch { return }
  if (file.includes('dsh-legacy-compat')) return
  if (/node_modules|node_modules\\/.test(file) && !/agent-presets/.test(file)) return
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const r of RULES) {
      r.re.lastIndex = 0;
      if (r.re.test(line)) hits.push({ file, line: i + 1, label: r.label, status: r.status, text: line.trim().slice(0, 140) });
    }
    for (const w of WATCH) {
      w.re.lastIndex = 0;
      if (w.re.test(line)) hits.push({ file, line: i + 1, label: w.label, status: 'watch', text: line.trim().slice(0, 140) });
    }
  });
}

function collect(dir, out, depth) {
  if (!dir || !fs.existsSync(dir) || depth > 7) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' && !p.includes('.agent-presets')) continue;
      collect(p, out, depth + 1);
    } else if (/\.(mjs|js|yml|yaml)$/.test(e.name) && !/.map$/.test(e.name)) out.push(p);
  }
}

const roots = [path.join(home, '.agent-presets'), ...extraDirs]
const files = [];
for (const r of roots) collect(r, files, 0);
const hits = [];
for (const f of files) scanFile(f, hits);

const covered = hits.filter(h => h.status === 'covered');
const watch = hits.filter(h => h.status === 'watch');
console.log('\n[dsh-legacy-compat] 兼容扫描结果');
console.log('  扫描文件数:', files.length, '| 命中旧 API:', hits.length, '（可被垫片覆盖 ' + covered.length + ' / 需关注 ' + watch.length + '）');
for (const h of hits) {
  console.log('  [' + (h.status === 'covered' ? '✓ 覆盖' : '? 关注') + '] ' + h.file.replace(/\\/g, '/').replace(home, '~') + ':' + h.line + '  — ' + h.label);
  console.log('        ' + h.text);
}
if (!hits.length) console.log('  （没有发现旧 API 引用，或仅安装此插件作“坏日志启动保护”用）');
console.log('\n说明：✓ 覆盖 = 装本插件后不会再因该用法崩溃（Session.events 别名已恢复）；' + '? 关注 = 新版 API 变化但一般不会崩，如遇报错请附堆栈反馈。\n');
