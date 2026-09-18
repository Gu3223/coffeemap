import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, ArrowUpDown, ChevronDown, Clock3, Coffee, ExternalLink, Heart, ImageOff, LocateFixed, LoaderCircle, MapPin, Navigation, Radio, RotateCcw, Search, SlidersHorizontal, Star, X } from 'lucide-react'
import { Circle, MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './styles.css'

const DEFAULT_LOCATION = { latitude: 39.7486, longitude: -104.992, label: '丹佛市中心' }
const DEFAULT_RADIUS_METERS = 2000
const DEFAULT_CATEGORY = 'cafe'
const RADIUS_OPTIONS = [{ label: '500m', meters: 500 }, { label: '1km', meters: 1000 }, { label: '2km', meters: 2000 }, { label: '5km', meters: 5000 }]
const CATEGORY_OPTIONS = [{ id: 'cafe', label: '咖啡', icon: '☕' }, { id: 'internet_cafe', label: '网吧', icon: '◈' }, { id: 'massage', label: '按摩', icon: '✦' }]
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const AMAP_ENDPOINT = 'https://restapi.amap.com/v5/place/around'
const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || ''
const AMAP_KEYWORDS = { cafe: '咖啡', internet_cafe: '网吧', massage: '按摩' }
const FALLBACK_CAFES = [
  { id: 'fallback-1', name: 'Owl & Finch', address: '17th Street · LoDo', category: '咖啡店', rating: null, reviews: null, distanceKm: .4, open: null, openingHours: null, priceValue: null, priceLabel: null, priceLevel: '未知', tags: ['OpenStreetMap'], image: null, photos: [], position: [39.7507, -104.9952], color: '#c46c42', source: 'openstreetmap' },
  { id: 'fallback-2', name: 'Morrow Coffee', address: 'Larimer Square', category: '咖啡店', rating: null, reviews: null, distanceKm: .7, open: null, openingHours: null, priceValue: null, priceLabel: null, priceLevel: '未知', tags: ['OpenStreetMap'], image: null, photos: [], position: [39.7477, -104.9971], color: '#d09b38', source: 'openstreetmap' },
]

function haversineKm(a, b) {
  const radians = value => value * Math.PI / 180
  const dLat = radians(b[0] - a[0]); const dLng = radians(b[1] - a[1])
  const latA = radians(a[0]); const latB = radians(b[0])
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(latA) * Math.cos(latB)
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function colorFor(index) { return ['#c46c42', '#d09b38', '#8d6b55', '#a36b4c', '#70806a'][index % 5] }
function formatAddress(tags = {}) { return [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || tags['addr:suburb'] || tags['addr:city'] || '地址未标注' }
function parseOpenStatus(value) { return value && /24\/7/i.test(value) ? true : null }
function priceInfo(value, category) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return { priceValue: null, priceLabel: null, priceLevel: '未知' }
  const suffix = category === 'internet_cafe' ? '/小时' : category === 'massage' ? '起' : ''
  return { priceValue: numeric, priceLabel: `¥${numeric}${suffix}`, priceLevel: numeric < 50 ? '¥' : numeric < 150 ? '¥¥' : '¥¥¥' }
}

function normalizeOsmElement(element, origin, index, category) {
  const tags = element.tags || {}; const lat = element.lat ?? element.center?.lat; const lon = element.lon ?? element.center?.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const cuisine = tags.cuisine?.split(';')[0]?.replaceAll('_', ' ')
  return { id: `osm-${element.type}-${element.id}`, name: tags.name || '未命名地点', address: formatAddress(tags), category: category === 'internet_cafe' ? '网吧' : category === 'massage' ? '按摩店' : cuisine || '咖啡店', rating: null, reviews: null, distanceKm: haversineKm(origin, [lat, lon]), open: parseOpenStatus(tags.opening_hours), openingHours: tags.opening_hours || null, ...priceInfo(null, category), tags: [tags['internet_access'] === 'wlan' ? 'Wi-Fi' : null, tags.takeaway === 'yes' ? '可外带' : null, tags.outdoor_seating === 'yes' ? '户外座位' : null].filter(Boolean), image: tags.image || null, photos: tags.image ? [tags.image] : [], position: [lat, lon], color: colorFor(index), source: 'openstreetmap' }
}

function normalizeAmapPoi(poi, origin, index, category) {
  const [longitude, latitude] = (poi.location || '').split(',').map(Number)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const business = poi.business || {}; const rating = Number(poi.rating ?? business.rating)
  const photos = (poi.photos || []).map(photo => photo.url).filter(Boolean)
  const pricing = priceInfo(business.cost || poi.cost, category)
  return { id: `amap-${poi.id}`, amapPoiId: poi.id, name: poi.name || '未命名地点', address: poi.address || poi.pname || '地址未标注', category: category === 'internet_cafe' ? '网吧' : category === 'massage' ? '按摩店' : poi.type?.split(';').pop() || '咖啡店', rating: Number.isFinite(rating) && rating > 0 ? rating : null, reviews: Number(business.rating_num || business.review_num) || null, distanceKm: Number(poi.distance || haversineKm([origin.latitude, origin.longitude], [latitude, longitude]) * 1000) / 1000, open: null, openingHours: business.opentime_week || business.opentime || null, ...pricing, tags: [business.tag || null].filter(Boolean), image: photos[0] || null, photos, position: [latitude, longitude], color: colorFor(index), source: 'amap', tel: poi.tel || null }
}

async function fetchAmapCafes(location, signal, radiusMeters, category) {
  const params = new URLSearchParams({ key: AMAP_KEY, location: `${location.longitude},${location.latitude}`, radius: String(radiusMeters), keywords: AMAP_KEYWORDS[category], sortrule: 'distance', page_size: '50', show_fields: 'business,photos' })
  const response = await fetch(`${AMAP_ENDPOINT}?${params}`, { signal })
  if (!response.ok) throw new Error(`Amap HTTP ${response.status}`)
  const data = await response.json(); if (data.status !== '1') throw new Error(data.info || 'Amap request failed')
  return (data.pois || []).map((poi, index) => normalizeAmapPoi(poi, location, index, category)).filter(Boolean)
}

async function fetchOsmCafes(location, signal, radiusMeters, category) {
  const { latitude, longitude } = location
  const selectors = category === 'internet_cafe' ? ['nwr["amenity"="internet_cafe"]'] : category === 'massage' ? ['nwr["shop"="massage"]', 'nwr["amenity"="massage"]'] : ['nwr["amenity"="cafe"]', 'nwr["shop"="coffee"]']
  const query = `[out:json][timeout:20];(${selectors.map(selector => `${selector}(around:${radiusMeters},${latitude},${longitude});`).join('')});out center tags;`
  const response = await fetch(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`, { signal })
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`)
  const data = await response.json(); const seen = new Set()
  return data.elements.map((element, index) => normalizeOsmElement(element, [latitude, longitude], index, category)).filter(Boolean).filter(place => { const key = `${place.name.toLowerCase()}-${place.position.map(value => value.toFixed(4)).join('-')}`; if (seen.has(key)) return false; seen.add(key); return true }).sort((a, b) => a.distanceKm - b.distanceKm)
}

async function fetchNearbyPlaces(location, signal, radiusMeters, category) {
  if (AMAP_KEY) { try { const result = await fetchAmapCafes(location, signal, radiusMeters, category); if (result.length) return result } catch (error) { if (error.name === 'AbortError') throw error } }
  return fetchOsmCafes(location, signal, radiusMeters, category)
}

function buildAmapNavigationUrl(place) { const [latitude, longitude] = place.position; return `https://uri.amap.com/marker?${new URLSearchParams({ position: `${longitude},${latitude}`, name: place.name, src: 'roast-roam', callnative: '1' })}` }
function buildXiaohongshuSearchUrl(place) { return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(`${place.name} ${place.category}`)}` }
function openCafeNavigation(place) { window.open(buildAmapNavigationUrl(place), '_blank', 'noopener,noreferrer') }

function Stars({ value }) { if (value == null) return <span className="no-rating">暂无评分</span>; return <span className="stars" aria-label={`${value} 分`}>{[0,1,2,3,4].map(index => <Star key={index} size={13} fill={index < Math.round(value) ? 'currentColor' : 'none'} />)}</span> }

function CafeCard({ place, selected, favorite, onSelect, onFavorite, onNavigate, onDetails }) {
  const status = place.open === true ? '营业中' : place.open === false ? '已打烊' : '营业时间未知'
  return <article className={`cafe-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(place.id)}><div className="card-image">{place.image ? <img src={place.image} alt=""/> : <div className="image-placeholder"><Coffee size={27}/></div>}<button className={`heart ${favorite ? 'liked' : ''}`} onClick={event => { event.stopPropagation(); onFavorite(place.id) }} aria-label="收藏"><Heart size={16} fill={favorite ? 'currentColor' : 'none'}/></button><span className={`open-pill ${place.open === false ? 'closed' : place.open == null ? 'unknown' : ''}`}>{status}</span></div><div className="card-copy"><div className="card-top"><div><h3>{place.name}</h3><p>{place.address}</p></div><div className="rating">{place.rating != null && <strong>{place.rating.toFixed(1)}</strong>}<Stars value={place.rating}/></div></div><div className="card-meta"><span><Navigation size={13}/>{place.distanceKm.toFixed(1)} km</span><span><Coffee size={13}/>{place.category}</span>{place.priceLabel && <span className="price-meta">{place.priceLabel}</span>}</div><div className="tags">{(place.tags.length ? place.tags : [place.source === 'amap' ? '高德数据' : 'OpenStreetMap']).map(tag => <span key={tag}>{tag}</span>)}</div><div className="card-actions"><button className="details-button" onClick={event => { event.stopPropagation(); onDetails(place) }}>查看详情 <ExternalLink size={13}/></button><button className="nav-button" onClick={event => { event.stopPropagation(); onNavigate(place) }}><Navigation size={13}/>导航</button></div></div></article>
}

function CafeDetailDrawer({ place, favorite, onClose, onFavorite, onNavigate }) {
  if (!place) return null
  const status = place.open === true ? '营业中' : place.open === false ? '已打烊' : '营业时间未知'
  return <div className="drawer-backdrop" onClick={onClose}><aside className="detail-drawer" onClick={event => event.stopPropagation()}><button className="drawer-close" onClick={onClose} aria-label="关闭"><X size={19}/></button><div className="drawer-photo">{place.image ? <img src={place.image} alt=""/> : <div className="drawer-placeholder"><ImageOff size={30}/><span>暂无门店图片</span></div>}<span className={`open-pill ${place.open === false ? 'closed' : 'unknown'}`}>{status}</span></div><div className="drawer-content"><div className="drawer-kicker">{place.source === 'amap' ? 'AMAP PLACE' : 'OPENSTREETMAP PLACE'}</div><div className="drawer-title-row"><div><h2>{place.name}</h2><p>{place.address}</p></div><button className={`heart drawer-heart ${favorite ? 'liked' : ''}`} onClick={() => onFavorite(place.id)}><Heart size={17} fill={favorite ? 'currentColor' : 'none'}/></button></div><div className="drawer-rating">{place.rating != null ? <><strong>{place.rating.toFixed(1)}</strong><Stars value={place.rating}/><span>{place.reviews ? `${place.reviews} 条评价` : '高德评分'}</span></> : <span className="no-rating">暂无评分 · 等待更多用户评价</span>}</div><div className="drawer-facts"><span><Navigation size={15}/>{place.distanceKm.toFixed(1)} km</span><span><Clock3 size={15}/>{place.openingHours || status}</span><span className="price-fact"><Coffee size={15}/>{place.priceLabel || place.priceLevel || '价格未知'}</span></div>{place.tags.length > 0 && <div className="drawer-tags">{place.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}<div className="drawer-links"><a href={buildXiaohongshuSearchUrl(place)} target="_blank" rel="noreferrer">去小红书看评价 <ExternalLink size={13}/></a></div><button className="drawer-navigation" onClick={() => onNavigate(place)}><Navigation size={17}/>打开高德导航<ExternalLink size={15}/></button><p className="drawer-footnote">门店信息来源于 {place.source === 'amap' ? '高德地图' : 'OpenStreetMap'}，营业时间可能会有变化。</p></div></aside></div>
}

function Recenter({ center, onLocate }) { const map = useMap(); useEffect(() => { map.flyTo(center, 14, { duration: .7 }) }, [center, map]); return <button className="recenter" title="回到当前位置" onClick={() => { map.flyTo(center, 14); onLocate?.() }}><LocateFixed size={16}/></button> }
function markerIcon(place, active) { return L.divIcon({ className: 'custom-marker-wrap', html: `<div class="custom-marker ${active ? 'active' : ''}" style="--marker:${place.color}"><span>${place.rating == null ? '•' : place.rating}</span></div>`, iconSize: [active ? 48 : 39, active ? 48 : 39], iconAnchor: [active ? 24 : 19, active ? 46 : 37], popupAnchor: [0, -38] }) }

function MapView({ places, selected, onSelect, location, accuracy, onLocate }) {
  const center = useMemo(() => [location.latitude, location.longitude], [location.latitude, location.longitude])
  return <div className="map-wrap real-map"><MapContainer center={center} zoom={14} zoomControl={false} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><ZoomControl position="topright"/><Recenter center={center} onLocate={onLocate}/><Circle center={center} radius={accuracy || 40} pathOptions={{ color: '#5d90a4', fillColor: '#8bb6c5', fillOpacity: .12, weight: 1 }}/><Marker position={center} icon={L.divIcon({ className: 'user-location-wrap', html: '<div class="user-location-dot"></div>', iconSize: [18,18], iconAnchor: [9,9] })}/>{places.map(place => <Marker key={place.id} position={place.position} icon={markerIcon(place, selected === place.id)} eventHandlers={{ click: () => onSelect(place.id) }}><Popup><strong>{place.name}</strong><br/><span>{place.rating == null ? '暂无评分' : `★ ${place.rating}`} · {place.distanceKm.toFixed(1)} km</span><br/><a className="popup-nav" href={buildAmapNavigationUrl(place)} target="_blank" rel="noreferrer">打开高德导航 →</a></Popup></Marker>)}</MapContainer><div className="map-caption"><MapPin size={15}/> {location.label || '当前位置'} <span>·</span> {places.length} places nearby</div></div>
}

function App() {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('全部'); const [sort, setSort] = useState('评分优先'); const [radiusMeters, setRadiusMeters] = useState(DEFAULT_RADIUS_METERS); const [placeCategory, setPlaceCategory] = useState(DEFAULT_CATEGORY)
  const [selected, setSelected] = useState(null); const [detailPlace, setDetailPlace] = useState(null); const [favorites, setFavorites] = useState([]); const [location, setLocation] = useState(DEFAULT_LOCATION); const [locationStatus, setLocationStatus] = useState('idle'); const [isFollowing, setIsFollowing] = useState(false); const [places, setPlaces] = useState([]); const [placesStatus, setPlacesStatus] = useState('idle'); const [placesError, setPlacesError] = useState('')
  const watchId = useRef(null); const lastSearch = useRef(null); const abortRef = useRef(null); const placesRef = useRef([]); const radiusRef = useRef(DEFAULT_RADIUS_METERS); const categoryRef = useRef(DEFAULT_CATEGORY)
  radiusRef.current = radiusMeters; categoryRef.current = placeCategory

  const loadPlaces = useCallback(async (nextLocation, requestedRadius = radiusRef.current, requestedCategory = categoryRef.current) => {
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller; setPlacesStatus('loading'); setPlacesError('')
    try { const result = await fetchNearbyPlaces(nextLocation, controller.signal, requestedRadius, requestedCategory); placesRef.current = result; setPlaces(result); setSelected(current => result.some(place => place.id === current) ? current : result[0]?.id || null); lastSearch.current = [nextLocation.latitude, nextLocation.longitude]; setPlacesStatus('ready') } catch (error) { if (error.name === 'AbortError') return; setPlacesError('附近地点暂时无法更新，已保留当前结果。'); setPlacesStatus(placesRef.current.length ? 'ready' : 'error'); if (!placesRef.current.length) { placesRef.current = FALLBACK_CAFES; setPlaces(FALLBACK_CAFES) } }
  }, [])

  const applyPosition = useCallback(position => { const next = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, label: '我的实时位置' }; setLocation(next); setLocationStatus('ready'); const previous = lastSearch.current; if (!previous || haversineKm(previous, [next.latitude, next.longitude]) >= .5) loadPlaces(next, radiusRef.current, categoryRef.current) }, [loadPlaces])
  const requestLocation = useCallback(() => { const fallback = () => { setLocation(DEFAULT_LOCATION); loadPlaces(DEFAULT_LOCATION) }; if (!navigator.geolocation) { setLocationStatus('error'); setPlacesError('当前浏览器不支持定位，正在显示默认区域。'); fallback(); return }; setLocationStatus('requesting'); navigator.geolocation.getCurrentPosition(applyPosition, () => { setLocationStatus('denied'); setPlacesError('无法获取当前位置，当前显示默认区域。'); fallback() }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }) }, [applyPosition, loadPlaces])
  const toggleFollowing = () => { if (isFollowing) { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; setIsFollowing(false); return } if (!navigator.geolocation) { setLocationStatus('error'); setPlacesError('当前浏览器不支持实时定位。'); return } setIsFollowing(true); setLocationStatus('requesting'); watchId.current = navigator.geolocation.watchPosition(applyPosition, () => { setLocationStatus('denied'); setIsFollowing(false); setPlacesError('实时定位不可用，当前仍显示默认区域。') }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }) }
  useEffect(() => { requestLocation(); return () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); abortRef.current?.abort() } }, [requestLocation])

  const filters = placeCategory === 'cafe' ? ['全部', '营业中', '4.5+ 评分', '¥', '¥¥', '¥¥¥'] : ['全部', '营业中', '价格未知', '¥', '¥¥', '¥¥¥']
  const visible = useMemo(() => { const list = places.filter(place => (!query || `${place.name}${place.address}${place.category}`.toLowerCase().includes(query.toLowerCase())) && (filter === '全部' || (filter === '营业中' ? place.open === true : filter === '4.5+ 评分' ? place.rating != null && place.rating >= 4.5 : filter === '价格未知' ? place.priceLevel === '未知' : ['¥', '¥¥', '¥¥¥'].includes(filter) ? place.priceLevel === filter : true))); return [...list].sort((a, b) => sort === '距离优先' ? a.distanceKm - b.distanceKm : sort === '评分优先' ? ((b.rating ?? -1) - (a.rating ?? -1)) || a.distanceKm - b.distanceKm : 0) }, [places, query, filter, sort])
  const activeCategory = CATEGORY_OPTIONS.find(option => option.id === placeCategory) || CATEGORY_OPTIONS[0]; const locationLabel = locationStatus === 'requesting' ? '正在获取位置…' : isFollowing ? '实时跟随中' : locationStatus === 'ready' ? '我的位置' : location.label; const dataSourceLabel = places.some(place => place.source === 'amap') ? '高德地图数据' : 'OpenStreetMap 数据'
  const changeCategory = category => { setPlaceCategory(category); setFilter('全部'); setQuery(''); loadPlaces(location, radiusMeters, category) }; const changeRadius = radius => { setRadiusMeters(radius); loadPlaces(location, radius, placeCategory) }; const toggleFavorite = id => setFavorites(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); const openNavigation = place => openCafeNavigation(place)

  return <main><header className="header"><a className="brand"><span className="brand-mark">R</span><span>ROAST <i>&</i> ROAM</span></a><nav><a className="active">探索门店</a><a>我的收藏 <sup>{favorites.length || ''}</sup></a></nav><div className="location-actions"><button className="location" onClick={requestLocation}><Navigation size={15}/> {locationLabel} <ChevronDown size={14}/></button><button className={`follow-button ${isFollowing ? 'following' : ''}`} onClick={toggleFollowing}><Radio size={15}/>{isFollowing ? '停止跟随' : '实时跟随'}</button></div><button className="mobile-filter"><SlidersHorizontal size={18}/></button></header>
    <section className="hero"><div><p className="eyebrow">YOUR NEXT CUP IS CLOSER THAN YOU THINK</p><h1>马上来<br/><em>一杯</em></h1><p className="hero-subtitle">发现此刻，离你最近的好咖啡。</p></div><div className="hero-note"><span className="vertical-line"/><p>打开定位，<br/>让好味道自己出现。</p></div><div className="hero-orbit" aria-hidden="true"><span>NEARBY</span><strong>{radiusMeters / 1000}<br/><small>KM</small></strong></div></section>
    <section className="workspace"><div className="list-panel"><div className="explore-controls"><div className="category-tabs">{CATEGORY_OPTIONS.map(option => <button key={option.id} className={placeCategory === option.id ? 'active' : ''} onClick={() => changeCategory(option.id)}><span>{option.icon}</span>{option.label}</button>)}</div><div className="radius-tabs"><span>范围</span>{RADIUS_OPTIONS.map(option => <button key={option.meters} className={radiusMeters === option.meters ? 'active' : ''} onClick={() => changeRadius(option.meters)}>{option.label}</button>)}</div></div><div className="location-banner"><div className="location-banner-icon"><LocateFixed size={17}/></div><div><strong>{locationStatus === 'ready' ? `正在探索你附近的${activeCategory.label}` : `发现你附近的${activeCategory.label}`}</strong><span>{locationStatus === 'ready' ? `以 ${locationLabel} 为中心 · ${radiusMeters >= 1000 ? `${radiusMeters / 1000} km` : `${radiusMeters}m`} 范围` : '允许定位后，结果会更贴近你'}</span></div><button onClick={requestLocation}>{locationStatus === 'ready' ? '更新位置' : '使用当前位置'}</button></div><div className="search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${activeCategory.label}名称、街区或关键词...`}/>{query && <button onClick={() => setQuery('')}><X size={16}/></button>}</div><div className="toolbar"><div className="filter-scroll">{filters.map(value => <button key={value} className={filter === value ? 'chosen' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div><button className="sort" onClick={() => setSort(sort === '评分优先' ? '距离优先' : sort === '距离优先' ? '推荐排序' : '评分优先')}><ArrowUpDown size={14}/>{sort}</button></div><div className="result-head"><p><strong>{visible.length}</strong> 家{activeCategory.label}地点</p><span>{placesStatus === 'loading' ? '正在更新…' : placesStatus === 'error' ? '使用默认数据' : dataSourceLabel}</span></div>{placesError && <div className="notice error"><AlertCircle size={15}/><span>{placesError}</span><button onClick={() => loadPlaces(location)}><RotateCcw size={14}/></button></div>}<div className="cards">{placesStatus === 'loading' && !places.length ? <div className="empty"><LoaderCircle className="spin" size={25}/><h3>正在寻找附近的{activeCategory.label}</h3><p>正在连接实时地点数据。</p></div> : visible.length ? visible.map(place => <CafeCard key={place.id} place={place} selected={selected === place.id} favorite={favorites.includes(place.id)} onSelect={setSelected} onFavorite={toggleFavorite} onNavigate={openNavigation} onDetails={setDetailPlace}/>) : <div className="empty"><Coffee size={25}/><h3>没有找到合适的地点</h3><p>试试扩大范围或换个关键词。</p></div>}</div></div><MapView places={visible} selected={selected} onSelect={setSelected} location={location} accuracy={location.accuracy} onLocate={requestLocation}/></section><CafeDetailDrawer place={detailPlace} favorite={detailPlace ? favorites.includes(detailPlace.id) : false} onClose={() => setDetailPlace(null)} onFavorite={toggleFavorite} onNavigate={openNavigation}/>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
