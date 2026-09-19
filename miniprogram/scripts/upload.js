/**
 * 用 miniprogram-ci 上传小程序代码（不需要打开微信开发者工具）。
 *
 * 私钥不进仓库：默认从仓库外的 ~/.config/wechat/ 读，可用 WX_UPLOAD_KEY 覆盖。
 * 上传目标是小程序后台的「开发版」，之后在后台或开发者工具里设为体验版。
 *
 * 用法：
 *   node scripts/upload.js                  # 版本取 package.json 的 version
 *   UPLOAD_DESC="说明" node scripts/upload.js
 */
const ci = require('miniprogram-ci')
const fs = require('fs')
const path = require('path')

const projectConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'project.config.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'))

const APPID = projectConfig.appid
const ROOT = path.resolve(__dirname, '..')
const PROJECT_PATH = path.join(ROOT, 'dist')
const KEY_PATH = process.env.WX_UPLOAD_KEY || path.join(process.env.USERPROFILE || process.env.HOME || '', '.config', 'wechat', `private.${APPID}.key`)
const VERSION = process.env.UPLOAD_VERSION || packageJson.version || '0.0.1'
const DESC = process.env.UPLOAD_DESC || `半醒半松 ${VERSION}`

function fail(message) {
  console.error(`上传中止：${message}`)
  process.exit(1)
}

if (!APPID || !/^wx[0-9a-f]{16}$/.test(APPID)) fail(`project.config.json 里的 appid 不合法：${APPID}`)
if (!fs.existsSync(PROJECT_PATH)) fail(`构建产物不存在：${PROJECT_PATH}，先跑 npm run build:weapp`)
if (!fs.existsSync(KEY_PATH)) fail(`找不到上传私钥：${KEY_PATH}\n把 key 放到该路径，或用 WX_UPLOAD_KEY 指定。私钥不要放进仓库。`)

const project = new ci.Project({
  appid: APPID,
  type: 'miniProgram',
  projectPath: PROJECT_PATH,
  privateKeyPath: KEY_PATH,
  ignores: ['node_modules/**/*', '**/*.map']
})

async function main() {
  console.log(`上传中：appid=${APPID} version=${VERSION}`)
  console.log(`项目目录：${PROJECT_PATH}`)
  try {
    const result = await ci.upload({
      project,
      version: VERSION,
      desc: DESC,
      // 与 dist 的编译结果保持一致：ES6 转 ES5 已有 Taro 处理，这里只做压缩与样式前缀
      setting: { es6: false, es7: false, minify: true, autoPrefixWXSS: true, codeProtect: false },
      onProgressUpdate: info => {
        if (typeof info === 'string') console.log('  ', info)
        else if (info && info._msg) console.log('  ', info._msg)
      }
    })
    console.log('\n上传成功')
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    // 常见失败：私钥与 AppID 不匹配、后台开启了 IP 白名单而本机 IP 不在名单里、代码包过大
    console.error('\n上传失败')
    console.error(String(error && error.message ? error.message : error))
    if (error && error.errCode) console.error('errCode:', error.errCode)
    process.exit(1)
  }
}

main()
