import AMapLoader from '@amap/amap-jsapi-loader'

const jsKey = import.meta.env.VITE_AMAP_JS_KEY || ''
const serviceHost = import.meta.env.VITE_AMAP_JS_SERVICE_HOST || ''
let amapPromise = null

export function hasAmapJsConfig() {
  return Boolean(jsKey && serviceHost)
}

export function loadAmap() {
  if (!hasAmapJsConfig()) return Promise.reject(new Error('AMAP_JS_UNAVAILABLE'))
  if (!amapPromise) {
    window._AMapSecurityConfig = { serviceHost }
    amapPromise = AMapLoader.load({
      key: jsKey,
      version: '2.0',
      plugins: ['AMap.Geolocation', 'AMap.Geocoder']
    }).catch(error => {
      amapPromise = null
      throw error
    })
  }
  return amapPromise
}

function sourceOf(value) {
  const source = String(value || '').toLowerCase()
  if (source.includes('sdk')) return 'sdk'
  if (source.includes('ip')) return 'ip'
  return 'html5'
}

function normalizeAmapPosition(result) {
  const longitude = Number(result?.position?.lng ?? result?.position?.getLng?.())
  const latitude = Number(result?.position?.lat ?? result?.position?.getLat?.())
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const accuracy = Number(result.accuracy)
  const source = sourceOf(result.location_type)
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null,
    source,
    address: result.formattedAddress || '',
    label: result.formattedAddress || (source === 'ip' ? '当前城市附近' : '我的实时位置'),
    coordinateSystem: 'gcj02',
    isApproximate: source === 'ip' || !Number.isFinite(accuracy)
  }
}

function convertGps(AMap, position) {
  return new Promise((resolve, reject) => {
    const { longitude, latitude, accuracy } = position.coords
    AMap.convertFrom([longitude, latitude], 'gps', (status, result) => {
      const converted = result?.locations?.[0]
      if (status !== 'complete' || !converted) {
        reject(new Error('AMAP_CONVERT_FAILED'))
        return
      }
      resolve({
        latitude: Number(converted.lat ?? converted.getLat?.()),
        longitude: Number(converted.lng ?? converted.getLng?.()),
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        source: 'html5',
        address: '',
        label: '我的实时位置',
        coordinateSystem: 'gcj02',
        isApproximate: !Number.isFinite(accuracy)
      })
    })
  })
}

function betterPosition(current, candidate) {
  if (!candidate) return current
  if (!current) return candidate
  const currentScore = current.source === 'ip' ? Infinity : (current.accuracy ?? Infinity)
  const candidateScore = candidate.source === 'ip' ? Infinity : (candidate.accuracy ?? Infinity)
  return candidateScore < currentScore ? candidate : current
}

export async function locatePrecisely({ timeoutMs = 8000, targetAccuracy = 30 } = {}) {
  const AMap = await loadAmap()
  return new Promise((resolve, reject) => {
    let best = null
    let finished = false
    let watchId = null
    const geolocation = new AMap.Geolocation({
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 0,
      convert: true,
      GeoLocationFirst: true,
      needAddress: true,
      extensions: 'base',
      showButton: false,
      showMarker: false,
      showCircle: false,
      panToLocation: false
    })

    const finish = error => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      if (best) resolve(best)
      else reject(error || new Error('LOCATION_UNAVAILABLE'))
    }
    const accept = candidate => {
      if (finished) return
      best = betterPosition(best, candidate)
      if (best?.source !== 'ip' && best?.accuracy != null && best.accuracy <= targetAccuracy) finish()
    }
    const timer = setTimeout(() => finish(), timeoutMs)

    geolocation.getCurrentPosition((status, result) => {
      if (finished) return
      if (status === 'complete') accept(normalizeAmapPosition(result))
    })

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        position => { convertGps(AMap, position).then(accept).catch(() => {}) },
        () => {},
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
      )
    }
  })
}

export async function startPreciseWatch(onPosition, onError) {
  const AMap = await loadAmap()
  if (!navigator.geolocation) throw new Error('LOCATION_UNAVAILABLE')
  let active = true
  const watchId = navigator.geolocation.watchPosition(
    position => {
      convertGps(AMap, position)
        .then(converted => { if (active) onPosition(converted) })
        .catch(error => { if (active) onError?.(error) })
    },
    error => { if (active) onError?.(error) },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
  )
  return () => {
    active = false
    navigator.geolocation.clearWatch(watchId)
  }
}
