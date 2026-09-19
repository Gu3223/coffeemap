/**
 * 「我的标记」本地存储层
 *
 * 为什么先做本地而不是共享数据库：高德不提供「是否适合学习」这类字段，只能自己产生数据。
 * 但这个站目前几乎没有其他访客，共享库一开始必然是空的 —— 筛选照样筛不出东西，还白白引入
 * 数据库、防刷和内容审核的成本。本地标记让筛选**立刻可用**，而且同一套 UI 之后可以平滑升级为
 * 把数据同步到 CloudBase（只需要替换本文件的读写实现）。
 *
 * 存储以高德 POI id 为键（比名称稳定），整体存成一个 JSON。
 * 注意：localStorage 按浏览器隔离，换设备或清缓存会丢（导出/导入还没做）。
 */

import { readJson, writeJson } from './localStore.js'

const STORAGE_KEY = 'xunyi-bei:place-notes:v1'

/** 可用于标记的属性维度，顺序即展示顺序 */
export const NOTE_ATTRIBUTES = [
  { id: 'quiet', label: '安静' },
  { id: 'socket', label: '有插座' },
  { id: 'wifi', label: 'Wi-Fi' },
  { id: 'longstay', label: '适合久坐' },
  { id: 'fewpeople', label: '人少' }
]

const ATTRIBUTE_IDS = NOTE_ATTRIBUTES.map(attribute => attribute.id)

function sanitizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null
  const verdict = raw.verdict === 'good' || raw.verdict === 'bad' ? raw.verdict : null
  const attributes = Array.isArray(raw.attributes) ? raw.attributes.filter(id => ATTRIBUTE_IDS.includes(id)) : []
  const note = typeof raw.note === 'string' ? raw.note.slice(0, 200) : ''
  if (!verdict && !attributes.length && !note) return null
  return { verdict, attributes: [...new Set(attributes)], note, updatedAt: Number(raw.updatedAt) || Date.now() }
}

export function readNotes(storage) {
  const parsed = readJson(STORAGE_KEY, {}, storage)
  const notes = {}
  for (const [key, value] of Object.entries(parsed)) {
    const note = sanitizeNote(value)
    if (note) notes[key] = note
  }
  return notes
}

export function writeNotes(notes, storage) {
  return writeJson(STORAGE_KEY, notes, storage)
}

/** 合并写入某家店的标记；传空的 verdict/attributes/note 表示清除这条标记 */
export function updateNote(notes, placeKey, patch) {
  if (!placeKey) return notes
  const merged = sanitizeNote({ ...(notes[placeKey] || {}), ...patch, updatedAt: Date.now() })
  const next = { ...notes }
  if (merged) next[placeKey] = merged
  else delete next[placeKey]
  writeNotes(next)
  return next
}

export function noteKeyOf(place) { return place?.amapPoiId || place?.id || null }

/** 标记是否等同于「适合学习」：主判断为 good，或勾了至少一个学习相关属性 */
export function isStudyFriendly(note) {
  if (!note) return false
  if (note.verdict === 'bad') return false
  return note.verdict === 'good' || note.attributes.length > 0
}

export function attributeLabel(id) { return NOTE_ATTRIBUTES.find(attribute => attribute.id === id)?.label || id }
