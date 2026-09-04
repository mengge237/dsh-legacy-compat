#!/usr/bin/env node
// dsh-legacy-compat 一键卸载（过渡垫片，装得容易卸得干净）
// 用法:
//   node bin/uninstall.mjs                 # 默认卸载 web profile
//   node bin/uninstall.mjs --profile tui   # 指定 profile
//   node bin/uninstall.mjs --home <dshHome>
//   node bin/uninstall.mjs --dry-run       # 只预览，不改动
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const NAME = 'dsh-legacy-compat'
const argv = process.argv.slice(2)
let profile = 'web'
let home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
let dryRun = false
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--profile' && argv[i + 1]) profile = argv[i + 1]
  else if (argv[i] === '--home' && argv[i + 1]) home = path.resolve(argv[i + 1])
  else if (argv[i] === '--dry-run') dryRun = true
}
const ok = (m) => console.log('[uninstall]', m)
const warn = (m) => console.error('[uninstall][warn]', m)

const pkgFile = path.join(home, 'profiles', profile, 'package.json')
if (!fs.existsSync(pkgFile)) { warn('找不到 profile 清单: ' + pkgFile); process.exit(2) }

const pj = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
const bundles = pj.dsh?.profile?.bundles ?? []
const deps = pj.dependencies ?? {}
const inBundles = bundles.includes(NAME)
const inDeps = Object.prototype.hasOwnProperty.call(deps, NAME)
const linkDir = path.join(home, 'profiles', profile, 'node_modules', NAME)
const linkExists = fs.existsSync(linkDir)

if (!inBundles && !inDeps && !linkExists) {
  ok('该 profile 未安装 ' + NAME + '，无需卸载');
  process.exit(0)
}
ok('将卸载 ' + NAME + '（profile: ' + profile + '）:');
if (inBundles) console.log('   - 从 dsh.profile.bundles 移除')
if (inDeps) console.log('   - 从 dependencies 移除 link 记录')
if (linkExists) console.log('   - 删除 node_modules/' + NAME + ' 链接（不影响源码目录）')

if (dryRun) { ok('--dry-run：以上为预览，未做任何修改'); process.exit(0) }

// 备份原清单（人性化：可回退）
const bak = pkgFile + '.bak-uninstall-' + new Date().toISOString().replace(/[:.]/g, '-')
fs.copyFileSync(pkgFile, bak)
ok('已备份: ' + path.basename(bak))

let changed = false
if (inBundles) { pj.dsh.profile.bundles = bundles.filter((b) => b !== NAME); changed = true }
if (inDeps) { delete deps[NAME]; changed = true }
if (changed) {
  fs.writeFileSync(pkgFile, JSON.stringify(pj, null, 2) + '\n', 'utf8')
  ok('package.json 已清理')
}
if (linkExists) {
  fs.rmSync(linkDir, { recursive: true, force: true })
  ok('node_modules 链接已删除')
}

ok('卸载完成。请完全重启 dsh ' + profile + ' 后生效。');
ok('备注: 若之前有被隔离的坏会话日志，保留在 ' + path.join(home, 'dsh-legacy-compat-quarantine') + '，可自行处理。');
