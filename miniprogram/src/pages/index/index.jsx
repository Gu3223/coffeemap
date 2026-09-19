import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { fetchNearbyPlaces } from '@shared/amapSearch.js'
import { chainRank, isChainPlace } from '@shared/chains.js'
import { curatedEntryFor } from '@shared/curated.js'
import './index.css'

const RADIUS_OPTIONS = [500, 1000, 2000]

/** 与网页端同一套排序口径：先连锁沉底，再按距离 */
function sortPlaces(list) {
  return [...list].sort((a, b) => chainRank(a) - chainRank(b) || a.distanceKm - b.distanceKm)
}

export default function Index() {
  const [places, setPlaces] = useState([])
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [radius, setRadius] = useState(1000)
  const [location, setLocation] = useState(null)

  // 首次进入：取定位，然后检索。定位失败给手动提示，不静默失败。
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setStatus('locating'); setMessage('正在获取位置…')
      try {
        const res = await Taro.getLocation({ type: 'gcj02' })
        if (cancelled) return
        const next = { latitude: res.latitude, longitude: res.longitude }
        setLocation(next)
        await load(next, radius)
      } catch (error) {
        if (cancelled) return
        setStatus('error')
        setMessage(error?.errMsg?.includes('auth') ? '需要位置权限才能查找附近门店，请在设置里开启' : '定位失败，请重试')
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  const load = async (target, meters) => {
    setStatus('loading'); setMessage('正在搜索附近的咖啡店…')
    try {
      // 逻辑层的第四个参数是增量回调：先出最近的，再逐步补全
      const list = await fetchNearbyPlaces(target, null, meters, 'cafe', partial => setPlaces(sortPlaces(partial)))
      setPlaces(sortPlaces(list))
      setStatus(list.length ? 'ready' : 'empty')
      setMessage(list.length ? `共 ${list.length} 家` : `${meters} 米内没有找到咖啡店`)
    } catch (error) {
      setStatus('error')
      setMessage(error.message === 'MISSING_AMAP_KEY' ? '服务端未配置高德 Key' : '搜索失败，请稍后重试')
    }
  }

  const changeRadius = meters => {
    setRadius(meters)
    if (location) load(location, meters)
  }

  return (
    <View className="page">
      <View className="head">
        <Text className="brand">半醒半松</Text>
        <Text className="status">{message}</Text>
      </View>

      <View className="radii">
        {RADIUS_OPTIONS.map(meters => (
          <Text
            key={meters}
            className={`radius ${radius === meters ? 'active' : ''}`}
            onClick={() => changeRadius(meters)}
          >
            {meters >= 1000 ? `${meters / 1000}km` : `${meters}m`}
          </Text>
        ))}
      </View>

      <ScrollView scrollY className="list">
        {places.map(place => {
          const curated = curatedEntryFor(place)
          return (
            <View key={place.id} className="card">
              <View className="card-top">
                <Text className="name">{place.name}</Text>
                <Text className="distance">{place.distanceKm.toFixed(1)} km</Text>
              </View>
              <Text className="address">{place.address}</Text>
              <View className="tags">
                {curated && <Text className="tag curated">口碑推荐</Text>}
                {isChainPlace(place) && <Text className="tag chain">连锁</Text>}
                {place.rating != null && place.rating >= 2 && <Text className="tag">★ {place.rating.toFixed(1)}</Text>}
              </View>
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}
