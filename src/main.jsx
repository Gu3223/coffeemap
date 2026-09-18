import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Search, Navigation, Heart, SlidersHorizontal, ChevronDown, MapPin, Coffee, Star, X, ArrowUpDown, LocateFixed, Radio, LoaderCircle, AlertCircle, RotateCcw } from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './styles.css'

const DEFAULT_LOCATION = { latitude: 39.7486, longitude: -104.992, label: '丹佛市中心' }
const SEARCH_RADIUS_METERS = 2000
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const FALLBACK_CAFES = [
  { id:'fallback-1', name:'Owl & Finch', address:'17th Street · LoDo', rating:null, reviews:null, distanceKm:.4, open:null, category:'咖啡店', tags:['OpenStreetMap'], image:null, position:[39.7507,-104.9952], color:'#c46c42', source:'openstreetmap' },
  { id:'fallback-2', name:'Morrow Coffee', address:'Larimer Square', rating:null, reviews:null, distanceKm:.7, open:null, category:'咖啡店', tags:['OpenStreetMap'], image:null, position:[39.7477,-104.9971], color:'#d09b38', source:'openstreetmap' },
]

function haversineKm(a, b) {
  const earthRadius = 6371
  const radians = value => value * Math.PI / 180
  const dLat = radians(b[0] - a[0])
  const dLng = radians(b[1] - a[1])
  const latA = radians(a[0])
  const latB = radians(b[0])
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(latA) * Math.cos(latB)
  return earthRadius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function formatAddress(tags = {}) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
  return street || tags['addr:suburb'] || tags['addr:city'] || '地址未标注'
}

function parseOpenStatus(openingHours) {
  if (!openingHours) return null
  if (/24\/7/i.test(openingHours)) return true
  return null
}

function colorFor(index) { return ['#c46c42', '#d09b38', '#8d6b55', '#a36b4c', '#70806a'][index % 5] }

function normalizeOverpassElement(element, origin, index) {
  const tags = element.tags || {}
  const lat = element.lat ?? element.center?.lat
  const lon = element.lon ?? element.center?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  const cuisine = tags.cuisine?.split(';')[0]?.replaceAll('_', ' ')
  return {
    id: `osm-${element.type}-${element.id}`,
    name: tags.name || '未命名咖啡店',
    address: formatAddress(tags),
    rating: null,
    reviews: null,
    distanceKm: haversineKm(origin, [lat, lon]),
    open: parseOpenStatus(tags.opening_hours),
    category: cuisine || '咖啡店',
    tags: [tags['internet_access'] === 'wlan' ? 'Wi-Fi' : null, tags.takeaway === 'yes' ? '可外带' : null, tags.outdoor_seating === 'yes' ? '户外座位' : null].filter(Boolean),
    image: tags.image || null,
    position: [lat, lon],
    color: colorFor(index),
    source: 'openstreetmap',
  }
}

async function fetchNearbyCafes(location, signal) {
  const { latitude, longitude } = location
  const query = `[out:json][timeout:20];(nwr["amenity"="cafe"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude});nwr["shop"="coffee"](around:${SEARCH_RADIUS_METERS},${latitude},${longitude}););out center tags;`
  const response = await fetch(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`, { signal })
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`)
  const data = await response.json()
  const seen = new Set()
  return data.elements.map((element, index) => normalizeOverpassElement(element, [latitude, longitude], index)).filter(Boolean).filter(cafe => {
    const key = `${cafe.name.toLowerCase()}-${cafe.position.map(value => value.toFixed(4)).join('-')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => a.distanceKm - b.distanceKm)
}

function Stars({ value }) {
  if (value == null) return <span className="no-rating">暂无评分</span>
  return <span className="stars" aria-label={`${value} 分`}>{[0,1,2,3,4].map(i => <Star key={i} size={13} fill={i < Math.round(value) ? 'currentColor' : 'none'} />)}</span>
}

function CafeCard({ cafe, selected, favorite, onSelect, onFavorite }) {
  const status = cafe.open === true ? '营业中' : cafe.open === false ? '已打烊' : '营业时间未知'
  return <article className={`cafe-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(cafe.id)}>
    <div className="card-image">{cafe.image ? <img src={cafe.image} alt=""/> : <div className="image-placeholder"><Coffee size={27}/></div>}<button className={`heart ${favorite ? 'liked' : ''}`} onClick={event => { event.stopPropagation(); onFavorite(cafe.id) }} aria-label="收藏"><Heart size={16} fill={favorite ? 'currentColor' : 'none'}/></button><span className={`open-pill ${cafe.open === false ? 'closed' : cafe.open == null ? 'unknown' : ''}`}>{status}</span></div>
    <div className="card-copy"><div className="card-top"><div><h3>{cafe.name}</h3><p>{cafe.address}</p></div><div className="rating">{cafe.rating != null && <strong>{cafe.rating}</strong>}<Stars value={cafe.rating}/></div></div><div className="card-meta"><span><Navigation size={13}/>{cafe.distanceKm.toFixed(1)} km</span><span><Coffee size={13}/>{cafe.category}</span></div><div className="tags">{(cafe.tags.length ? cafe.tags : ['OpenStreetMap']).map(tag => <span key={tag}>{tag}</span>)}</div></div>
  </article>
}

function Recenter({ center, onLocate }) {
  const map = useMap()
  useEffect(() => { map.flyTo(center, 14, { duration: .7 }) }, [center, map])
  return <button className="recenter" title="回到当前位置" onClick={() => { map.flyTo(center, 14); onLocate?.() }}><LocateFixed size={16}/></button>
}

function markerIcon(cafe, active) {
  const label = cafe.rating == null ? '•' : cafe.rating
  return L.divIcon({ className:'custom-marker-wrap', html:`<div class="custom-marker ${active?'active':''}" style="--marker:${cafe.color}"><span>${label}</span></div>`, iconSize:[active?48:39, active?48:39], iconAnchor:[active?24:19, active?46:37], popupAnchor:[0,-38] })
}

function MapView({ visibleCafes, selected, onSelect, location, accuracy, onLocate }) {
  const center = useMemo(() => [location.latitude, location.longitude], [location.latitude, location.longitude])
  return <div className="map-wrap real-map"><MapContainer center={center} zoom={14} zoomControl={false} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><ZoomControl position="topright"/><Recenter center={center} onLocate={onLocate}/><Circle center={center} radius={accuracy || 40} pathOptions={{ color:'#5d90a4', fillColor:'#8bb6c5', fillOpacity:.12, weight:1 }}/><Marker position={center} icon={L.divIcon({ className:'user-location-wrap', html:'<div class="user-location-dot"></div>', iconSize:[18,18], iconAnchor:[9,9] })}/>{visibleCafes.map(cafe => <Marker key={cafe.id} position={cafe.position} icon={markerIcon(cafe, selected === cafe.id)} eventHandlers={{ click:() => onSelect(cafe.id) }}><Popup><strong>{cafe.name}</strong><br/><span>{cafe.rating == null ? '暂无评分' : `★ ${cafe.rating}`} · {cafe.distanceKm.toFixed(1)} km</span></Popup></Marker>)}</MapContainer><div className="map-caption"><MapPin size={15}/> {location.label || '当前位置'} <span>·</span> {visibleCafes.length} places nearby</div></div>
}

function App() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('全部')
  const [sort, setSort] = useState('推荐排序')
  const [selected, setSelected] = useState(null)
  const [favorites, setFavorites] = useState([])
  const [location, setLocation] = useState(DEFAULT_LOCATION)
  const [locationStatus, setLocationStatus] = useState('idle')
  const [isFollowing, setIsFollowing] = useState(false)
  const [cafes, setCafes] = useState([])
  const [cafesStatus, setCafesStatus] = useState('idle')
  const [cafesError, setCafesError] = useState('')
  const watchId = useRef(null)
  const lastSearch = useRef(null)
  const abortRef = useRef(null)

  const loadCafes = useCallback(async nextLocation => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setCafesStatus('loading')
    setCafesError('')
    try {
      const result = await fetchNearbyCafes(nextLocation, controller.signal)
      setCafes(result)
      setSelected(current => result.some(cafe => cafe.id === current) ? current : result[0]?.id || null)
      lastSearch.current = [nextLocation.latitude, nextLocation.longitude]
      setCafesStatus('ready')
    } catch (error) {
      if (error.name === 'AbortError') return
      setCafesError('附近门店暂时无法更新，已保留当前结果。')
      setCafesStatus(cafes.length ? 'ready' : 'error')
      if (!cafes.length) setCafes(FALLBACK_CAFES)
    }
  }, [cafes.length])

  const applyPosition = useCallback(position => {
    const next = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, label: '我的实时位置' }
    setLocation(next)
    setLocationStatus('ready')
    const previous = lastSearch.current
    if (!previous || haversineKm(previous, [next.latitude, next.longitude]) >= .5) loadCafes(next)
  }, [loadCafes])

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocationStatus('error'); setCafesError('当前浏览器不支持定位，正在显示默认区域。'); return }
    setLocationStatus('requesting')
    navigator.geolocation.getCurrentPosition(applyPosition, () => { setLocationStatus('denied'); setCafesError('无法获取当前位置，当前显示丹佛市中心。') }, { enableHighAccuracy:true, timeout:10000, maximumAge:30000 })
  }, [applyPosition])

  const toggleFollowing = () => {
    if (isFollowing) { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; setIsFollowing(false); return }
    if (!navigator.geolocation) { setLocationStatus('error'); setCafesError('当前浏览器不支持实时定位。'); return }
    setIsFollowing(true); setLocationStatus('requesting')
    watchId.current = navigator.geolocation.watchPosition(applyPosition, () => { setLocationStatus('denied'); setIsFollowing(false); setCafesError('实时定位不可用，当前仍显示默认区域。') }, { enableHighAccuracy:true, timeout:15000, maximumAge:10000 })
  }

  useEffect(() => { loadCafes(DEFAULT_LOCATION); return () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); abortRef.current?.abort() } }, [])

  const filters = ['全部','营业中','4.5+ 评分','手冲咖啡','奶咖']
  const visible = useMemo(() => {
    let list = cafes.filter(cafe => (!query || `${cafe.name}${cafe.address}${cafe.category}`.toLowerCase().includes(query.toLowerCase())) && (filter === '全部' || (filter === '营业中' ? cafe.open === true : filter === '4.5+ 评分' ? cafe.rating != null && cafe.rating >= 4.5 : cafe.category === filter)))
    return [...list].sort((a, b) => sort === '距离优先' ? a.distanceKm - b.distanceKm : sort === '评分优先' ? (b.rating ?? -1) - (a.rating ?? -1) : 0)
  }, [cafes, query, filter, sort])
  const toggleFavorite = id => setFavorites(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const locationLabel = locationStatus === 'requesting' ? '正在获取位置…' : isFollowing ? '实时跟随中' : locationStatus === 'ready' ? '我的位置' : location.label

  return <main>
    <header className="header"><a className="brand"><span className="brand-mark">R</span><span>ROAST <i>&</i> ROAM</span></a><nav><a className="active">探索门店</a><a>我的收藏 <sup>{favorites.length || ''}</sup></a></nav><div className="location-actions"><button className="location" onClick={requestLocation}><Navigation size={15}/> {locationLabel} <ChevronDown size={14}/></button><button className={`follow-button ${isFollowing ? 'following' : ''}`} onClick={toggleFollowing} title={isFollowing ? '停止实时跟随' : '开启实时跟随'}><Radio size={15}/>{isFollowing ? '停止跟随' : '实时跟随'}</button></div><button className="mobile-filter"><SlidersHorizontal size={18}/></button></header>
    <section className="hero"><div><p className="eyebrow">YOUR DAILY CUP, DISCOVERED</p><h1>附近的<br/><em>咖啡店</em></h1></div><div className="hero-note"><span className="vertical-line"/><p>从第一口开始，<br/>认识这座城市。</p></div></section>
    <section className="workspace"><div className="list-panel"><div className="location-banner"><div className="location-banner-icon"><LocateFixed size={17}/></div><div><strong>{locationStatus === 'ready' ? '正在探索你附近的咖啡店' : '发现你附近的咖啡店'}</strong><span>{locationStatus === 'ready' ? `以 ${locationLabel} 为中心 · 2 km 范围` : '允许定位后，结果会更贴近你'}</span></div><button onClick={requestLocation}>{locationStatus === 'ready' ? '更新位置' : '使用当前位置'}</button></div><div className="search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索店名、街区或风味..."/>{query && <button onClick={() => setQuery('')}><X size={16}/></button>}</div><div className="toolbar"><div className="filter-scroll">{filters.map(value => <button key={value} className={filter === value ? 'chosen' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div><button className="sort" onClick={() => setSort(sort === '推荐排序' ? '距离优先' : sort === '距离优先' ? '评分优先' : '推荐排序')}><ArrowUpDown size={14}/>{sort}</button></div><div className="result-head"><p><strong>{visible.length}</strong> 家值得探索</p><span>{cafesStatus === 'loading' ? '正在更新…' : cafesStatus === 'error' ? '使用默认数据' : 'OpenStreetMap 数据'}</span></div>{cafesError && <div className="notice error"><AlertCircle size={15}/><span>{cafesError}</span><button onClick={() => loadCafes(location)}><RotateCcw size={14}/></button></div>}<div className="cards">{cafesStatus === 'loading' && !cafes.length ? <div className="empty"><LoaderCircle className="spin" size={25}/><h3>正在寻找附近的咖啡店</h3><p>正在连接 OpenStreetMap。</p></div> : visible.length ? visible.map(cafe => <CafeCard key={cafe.id} cafe={cafe} selected={selected === cafe.id} favorite={favorites.includes(cafe.id)} onSelect={setSelected} onFavorite={toggleFavorite}/>) : <div className="empty"><Coffee size={25}/><h3>没有找到这杯咖啡</h3><p>试试换个关键词或筛选条件。</p></div>}</div></div><MapView visibleCafes={visible} selected={selected} onSelect={setSelected} location={location} accuracy={location.accuracy} onLocate={requestLocation}/></section>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
