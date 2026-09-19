/**
 * 平台适配层：把小程序的能力注入给 shared/ 里的逻辑层。
 *
 * 逻辑层不读 import.meta.env、不碰 localStorage、不依赖 DOM，也不直接调全局 fetch，
 * 所以这一层是网页与小程序之间**唯一**需要分叉的地方。
 */
import Taro from '@tarojs/taro'
import { configureAmapSearch } from '@shared/amapSearch.js'
import { configureAmapDetails } from '@shared/amapDetails.js'
import { setDefaultStorage } from '@shared/localStore.js'

/** CloudBase 环境的 HTTP 网关域名（与网页端使用同一个） */
export const GATEWAY = 'https://coffeemap-prod-d7gyys53d1a4cee03-1491257715.ap-shanghai.app.tcloudbase.com'

// ---------- 存储 ----------
// shared/localStore.js 只要求 getItem / setItem / removeItem 三个方法
const storage = {
  getItem(key) {
    try {
      const value = Taro.getStorageSync(key)
      return value === '' || value === undefined ? null : value
    } catch { return null }
  },
  setItem(key, value) {
    try { Taro.setStorageSync(key, String(value)) } catch { /* 存储满或隐私模式：忽略，逻辑层本就是内存兜底 */ }
  },
  removeItem(key) {
    try { Taro.removeStorageSync(key) } catch { /* 同上 */ }
  }
}

// ---------- 请求 ----------
// 把 Taro.request 包成 fetch 形态：逻辑层只用到 ok / status / json() / text()
function fetchLike(url, options = {}) {
  return new Promise((resolve, reject) => {
    const task = Taro.request({
      url,
      method: options.method || 'GET',
      header: options.header,
      success: res => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        json: async () => res.data,
        text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data))
      }),
      fail: error => reject(new Error(error.errMsg || 'REQUEST_FAILED'))
    })
    // wx.request 没有 AbortSignal，手动映射到 task.abort()，逻辑层的取消逻辑才能生效
    if (options.signal) {
      if (options.signal.aborted) task.abort()
      else options.signal.addEventListener('abort', () => task.abort(), { once: true })
    }
  })
}

// ---------- 注入 ----------
export function setupPlatform() {
  setDefaultStorage(storage)
  configureAmapSearch({ proxyUrl: `${GATEWAY}/api/nearby`, fetchImpl: fetchLike })
  configureAmapDetails({ proxyUrl: `${GATEWAY}/api/place-detail`, fetchImpl: fetchLike })
}
