import { createReadStream, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import https from 'node:https'
import path from 'node:path'

const token = process.env.GH_TOKEN
if (!token) {
  console.error('GH_TOKEN is required')
  process.exit(1)
}

const repository = process.env.GITHUB_REPOSITORY || 'pmdaozhang/pixmint'
const [owner, repo] = repository.split('/')
const tag = process.env.RELEASE_TAG || 'v0.5.0'
const target =
  process.env.RELEASE_TARGET ||
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const releaseDir = process.env.RELEASE_DIR || 'release'
const assets = [
  {
    name: 'Pixmint-Setup-0.5.0.exe',
    file: path.join(releaseDir, 'Pixmint-Setup-0.5.0.exe'),
    contentType: 'application/octet-stream'
  },
  {
    name: 'Pixmint-Setup-0.5.0.exe.blockmap',
    file: path.join(releaseDir, 'Pixmint-Setup-0.5.0.exe.blockmap'),
    contentType: 'application/octet-stream'
  },
  {
    name: 'latest.yml',
    file: path.join(releaseDir, 'latest.yml'),
    contentType: 'text/yaml'
  }
]

const body = `Pixmint 0.5.0（Windows）

新增
- 长截图：自动滚动、逐帧采集、重叠拼接、固定表头、进度 HUD、暂停/继续/完成/取消、长图预览、保存/复制。
- 覆盖层工具栏“长截图”入口，结果使用独立预览窗口。

修复
- 修复每个拼接缝多出 1px 深色横线的问题。
- 修复首帧/后续帧底部边缘不一致导致匹配失败的问题。

验证
- 后端 smoke 700×3396；UI smoke 700×3396。
- Edge 真实长网页 700×3235；记事本长文档 700×13908。
- 20k px 三次编码 1110/1050/1034ms，RSS 增长 185/196/205MB。
- 深色 + 静态图片 + 代码块 700×5240。
- 保存路径、不可滚动窗口、上限提示、OCR/翻译/录制/钉图/设置回归通过。
- 完整单测 144 项通过。

已知限制
- VS Code 长文件因本机现有会话阻塞未验证；UAC/受保护窗口、网络懒加载图片未验证。
- 125% / 150% / 200% DPI 和多显示器按用户要求本轮不测。
- 安装包未代码签名，首次安装可能触发 SmartScreen。

升级
- 0.4.1 及更新版本可在应用内检查更新。
- 0.3.10 老用户需先手动安装一次 0.4.0。
`

function request(url, options = {}, payload = null) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, options, (response) => {
      let data = ''
      response.on('data', (chunk) => {
        data += chunk
      })
      response.on('end', () => {
        let parsed = null
        try {
          parsed = data ? JSON.parse(data) : null
        } catch {
          parsed = data
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ status: response.statusCode, data: parsed })
        } else {
          reject(
            new Error(
              `${options.method || 'GET'} ${url} -> ${response.statusCode}: ${
                typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
              }`
            )
          )
        }
      })
    })
    request.on('error', reject)
    if (payload) request.write(payload)
    request.end()
  })
}

function api(pathname, options = {}, payload = null) {
  return request(
    `https://api.github.com${pathname}`,
    {
      ...options,
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pixmint-release',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    },
    payload
  )
}

async function ensureRelease() {
  try {
    const existing = await api(`/repos/${owner}/${repo}/releases/tags/${tag}`)
    console.log('RELEASE_EXISTS', existing.data.id, existing.data.html_url)
    if (existing.data.draft) {
      const published = await api(`/repos/${owner}/${repo}/releases/${existing.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      }, JSON.stringify({ draft: false, prerelease: false }))
      console.log('RELEASE_PUBLISHED', published.data.html_url)
      return published.data
    }
    return existing.data
  } catch (error) {
    if (!String(error.message).includes('404')) throw error
  }

  const created = await api(`/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({
    tag_name: tag,
    target_commitish: target,
    name: 'Pixmint v0.5.0',
    body,
    draft: false,
    prerelease: false
  }))
  console.log('RELEASE_CREATED', created.data.id, created.data.html_url)
  return created.data
}

async function uploadAsset(releaseId, asset) {
  if (!existsSync(asset.file)) throw new Error(`missing asset: ${asset.file}`)
  const size = statSync(asset.file).size
  const existing = await api(
    `/repos/${owner}/${repo}/releases/${releaseId}/assets?per_page=100`
  )
  const same = existing.data.find((item) => item.name === asset.name)
  if (same) {
    await api(`/repos/${owner}/${repo}/releases/assets/${same.id}`, { method: 'DELETE' })
    console.log('ASSET_REMOVED', same.name)
  }

  await new Promise((resolve, reject) => {
    const request = https.request(
      `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'pixmint-release',
          'Content-Type': asset.contentType,
          'Content-Length': size
        }
      },
      (response) => {
        let data = ''
        response.on('data', (chunk) => {
          data += chunk
        })
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            const parsed = JSON.parse(data)
            console.log('ASSET_UPLOADED', parsed.name, parsed.size)
            resolve()
          } else {
            reject(new Error(`upload ${asset.name} -> ${response.statusCode}: ${data}`))
          }
        })
      }
    )
    request.on('error', reject)
    createReadStream(asset.file).pipe(request)
  })
}

const release = await ensureRelease()
for (const asset of assets) {
  await uploadAsset(release.id, asset)
}
const verified = await api(`/repos/${owner}/${repo}/releases/${release.id}`)
console.log(
  'RELEASE_OK',
  verified.data.tag_name,
  verified.data.draft,
  verified.data.assets.map((item) => `${item.name}:${item.size}`).join(',')
)
console.log('RELEASE_URL', verified.data.html_url)
