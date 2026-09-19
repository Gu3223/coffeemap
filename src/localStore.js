/**
 * 本地存储的极简封装：统一处理两件容易踩的事
 *   1. 隐私模式 / 配额异常时 localStorage 会直接抛错 —— 降级到内存，避免整页崩掉；
 *   2. 存进去的 JSON 可能被改坏 —— 读失败一律回退到 fallback，不把异常抛给渲染层。
 *
 * placeNotes（我的标记）和 favorites（我的收藏）共用这一份，不再各自复制一套。
 */

/** 内存兜底必须是模块级单例：每次调用新建 Map 会导致读写不在同一处，数据静默丢失 */
const memoryFallback = new Map()
const memoryStorage = {
  getItem: key => (memoryFallback.has(key) ? memoryFallback.get(key) : null),
  setItem: (key, value) => { memoryFallback.set(key, String(value)) },
  removeItem: key => { memoryFallback.delete(key) }
}

let defaultStorage = memoryStorage

/**
 * 平台层可替换默认存储。网页保持 localStorage，小程序入口传入 wx 的存储封装即可，
 * 这样 placeNotes / favorites 一行都不用改。
 */
export function setDefaultStorage(storage) {
  if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') defaultStorage = storage
}

export function getStorage() {
  if (defaultStorage !== memoryStorage) return defaultStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__xunyi_probe__'
      localStorage.setItem(probe, '1')
      localStorage.removeItem(probe)
      return localStorage
    }
  } catch { /* 隐私模式：用内存兜底 */ }
  return memoryStorage
}

export function readJson(key, fallback = null, storage = getStorage()) {
  try {
    const raw = storage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key, value, storage = getStorage()) {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
