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
const AMAP_ENDPOINT = 'https://restapi.amap.com/v5/place/around'
const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || ''
const AMAP_KEYWORDS = { cafe: ['咖啡', '咖啡馆', '咖啡厅', 'coffee'], internet_cafe: ['网吧', '网咖', '电竞馆'], massage: ['按摩', '推拿', '足疗', 'SPA'] }
const AMAP_PAGE_SIZE = 25
const AMAP_MAX_PAGES = 8
const MAX_RESULTS = 200

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

function classifyStudySuitability(poi, category) {
  if (category !== 'cafe') return { label: null, reason: null }
  const text = `${poi.name || ''} ${poi.type || ''} ${poi.business?.tag || ''}`.toLowerCase()
  if (/酒吧|ktv|夜店|live|电竞|club|bar/.test(text)) return { label: '不建议学习', reason: '门店信息显示可能存在较高噪音' }
  if (/自习|阅读|书店|共享空间|安静|study|reading|workspace|wifi|wi-fi/.test(text)) return { label: '适合学习', reason: '门店信息包含安静、阅读或 Wi-Fi 等特征' }
  return { label: '未判断', reason: '公开 POI 信息不足以判断环境' }
}

function classifyMassageProfile(poi, category) {
  if (category !== 'massage') return { label: null, reason: null }
  const business = poi.business || {}
  const complete = Boolean(poi.name && poi.address && (poi.tel || business.opentime || business.opentime_week))
  return { label: complete ? '信息较完整' : '信息较少', reason: complete ? '名称、地址和联系或营业信息较完整' : '部分地址、联系或营业信息缺失，建议到店前核实' }
}

function normalizeAmapPoi(poi, origin, index, category) {
  const [longitude, latitude] = (poi.location || '').split(',').map(Number)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const business = poi.business || {}; const rating = Number(poi.rating ?? business.rating)
  const photos = (poi.photos || []).map(photo => photo.url).filter(Boolean)
  const pricing = priceInfo(business.cost || poi.cost, category)
  const study = classifyStudySuitability(poi, category); const massage = classifyMassageProfile(poi, category)
  return { id: `amap-${poi.id}`, amapPoiId: poi.id, name: poi.name || '未命名地点', address: poi.address || poi.pname || '地址未标注', category: category === 'internet_cafe' ? '网吧' : category === 'massage' ? '按摩店' : poi.type?.split(';').pop() || '咖啡店', rating: Number.isFinite(rating) && rating > 0 ? rating : null, reviews: Number(business.rating_num || business.review_num) || null, distanceKm: Number(poi.distance || haversineKm([origin.latitude, origin.longitude], [latitude, longitude]) * 1000) / 1000, open: null, openingHours: business.opentime_week || business.opentime || null, ...pricing, studySuitability: study.label, studyReason: study.reason, massageProfile: massage.label, massageReason: massage.reason, tags: [business.tag || null].filter(Boolean), image: photos[0] || null, photos, position: [latitude, longitude], color: colorFor(index), source: 'amap', tel: poi.tel || null }
}

async function fetchAmapKeyword(location, signal, radiusMeters, category, keyword) {
  const pages = []
  for (let page = 1; page <= AMAP_MAX_PAGES && pages.length < MAX_RESULTS; page += 1) {
    const params = new URLSearchParams({ key: AMAP_KEY, location: `${location.longitude},${location.latitude}`, radius: String(radiusMeters), keywords: keyword, sortrule: 'distance', page_num: String(page), page_size: String(AMAP_PAGE_SIZE), show_fields: 'business,photos' })
    const response = await fetch(`${AMAP_ENDPOINT}?${params}`, { signal })
    if (!response.ok) throw new Error(`Amap HTTP ${response.status}`)
    const data = await response.json(); if (data.status !== '1') throw new Error(data.info || 'Amap request failed')
    const results = data.pois || []; pages.push(...results)
    if (results.length < AMAP_PAGE_SIZE) break
  }
  return pages
}

async function fetchAmapCafes(location, signal, radiusMeters, category) {
  if (!AMAP_KEY) throw new Error('MISSING_AMAP_KEY')
  const keywordResults = await Promise.all(AMAP_KEYWORDS[category].map(keyword => fetchAmapKeyword(location, signal, radiusMeters, category, keyword)))
  const seen = new Map(); let index = 0
  for (const poi of keywordResults.flat()) {
    const normalized = normalizeAmapPoi(poi, location, index, category); index += 1
    if (!normalized) continue
    const duplicate = seen.get(normalized.amapPoiId) || [...seen.values()].find(place => place.name.toLowerCase() === normalized.name.toLowerCase() && haversineKm(place.position, normalized.position) < .05)
    if (!duplicate) seen.set(normalized.amapPoiId, normalized)
    else if ((!duplicate.rating && normalized.rating) || (!duplicate.image && normalized.image)) seen.set(duplicate.amapPoiId, { ...duplicate, ...normalized, id: duplicate.id, amapPoiId: duplicate.amapPoiId })
  }
  return [...seen.values()].slice(0, MAX_RESULTS).sort((a, b) => ((b.rating ?? -1) - (a.rating ?? -1)) || a.distanceKm - b.distanceKm)
}

async function fetchNearbyPlaces(location, signal, radiusMeters, category) {
  return fetchAmapCafes(location, signal, radiusMeters, category)
}

function buildAmapNavigationUrl(place) { const [latitude, longitude] = place.position; return `https://uri.amap.com/marker?${new URLSearchParams({ position: `${longitude},${latitude}`, name: place.name, src: 'roast-roam', callnative: '1' })}` }
function buildXiaohongshuSearchUrl(place) { return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(`${place.name} ${place.category}`)}` }
function openCafeNavigation(place) { window.open(buildAmapNavigationUrl(place), '_blank', 'noopener,noreferrer') }

function Stars({ value }) { if (value == null) return <span className="no-rating">暂无评分</span>; return <span className="stars" aria-label={`${value} 分`}>{[0,1,2,3,4].map(index => <Star key={index} size={13} fill={index < Math.round(value) ? 'currentColor' : 'none'} />)}</span> }

function CafeCard({ place, selected, favorite, onSelect, onFavorite, onNavigate, onDetails }) {
  const status = place.open === true ? '营业中' : place.open === false ? '已打烊' : '营业时间未知'
  const classification = place.studySuitability && place.studySuitability !== '未判断' ? place.studySuitability : place.massageProfile
  return <article className={`cafe-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(place.id)}><div className="card-image">{place.image ? <img src={place.image} alt=""/> : <div className="image-placeholder"><Coffee size={27}/></div>}<button className={`heart ${favorite ? 'liked' : ''}`} onClick={event => { event.stopPropagation(); onFavorite(place.id) }} aria-label="收藏"><Heart size={16} fill={favorite ? 'currentColor' : 'none'}/></button><span className={`open-pill ${place.open === false ? 'closed' : place.open == null ? 'unknown' : ''}`}>{status}</span></div><div className="card-copy"><div className="card-top"><div><h3>{place.name}</h3><p>{place.address}</p></div><div className="rating">{place.rating != null && <strong>{place.rating.toFixed(1)}</strong>}<Stars value={place.rating}/></div></div><div className="card-meta"><span><Navigation size={13}/>{place.distanceKm.toFixed(1)} km</span><span><Coffee size={13}/>{place.category}</span>{place.priceLabel && <span className="price-meta">{place.priceLabel}</span>}</div><div className="tags">{[...place.tags, classification].filter(Boolean).map(tag => <span key={tag}>{tag}</span>)}</div><div className="card-actions"><button className="details-button" onClick={event => { event.stopPropagation(); onDetails(place) }}>查看详情 <ExternalLink size={13}/></button><button className="nav-button" onClick={event => { event.stopPropagation(); onNavigate(place) }}><Navigation size={13}/>导航</button></div></div></article>
}

function CafeDetailDrawer({ place, favorite, onClose, onFavorite, onNavigate }) {
  if (!place) return null
  const status = place.open === true ? '营业中' : place.open === false ? '已打烊' : '营业时间未知'
  const classification = place.studySuitability && place.studySuitability !== '未判断' ? place.studySuitability : place.massageProfile
  const classificationReason = place.studyReason || place.massageReason
  return <div className="drawer-backdrop" onClick={onClose}><aside className="detail-drawer" onClick={event => event.stopPropagation()}><button className="drawer-close" onClick={onClose} aria-label="关闭"><X size={19}/></button><div className="drawer-photo">{place.image ? <img src={place.image} alt=""/> : <div className="drawer-placeholder"><ImageOff size={30}/><span>暂无门店图片</span></div>}<span className={`open-pill ${place.open === false ? 'closed' : 'unknown'}`}>{status}</span></div><div className="drawer-content"><div className="drawer-kicker">AMAP PLACE</div><div className="drawer-title-row"><div><h2>{place.name}</h2><p>{place.address}</p></div><button className={`heart drawer-heart ${favorite ? 'liked' : ''}`} onClick={() => onFavorite(place.id)}><Heart size={17} fill={favorite ? 'currentColor' : 'none'}/></button></div><div className="drawer-rating">{place.rating != null ? <><strong>{place.rating.toFixed(1)}</strong><Stars value={place.rating}/><span>{place.reviews ? `${place.reviews} 条评价` : '高德评分'}</span></> : <span className="no-rating">暂无评分 · 等待更多用户评价</span>}</div><div className="drawer-facts"><span><Navigation size={15}/>{place.distanceKm.toFixed(1)} km</span><span><Clock3 size={15}/>{place.openingHours || status}</span><span className="price-fact"><Coffee size={15}/>{place.priceLabel || place.priceLevel || '价格未知'}</span></div>{(place.tags.length || classification) > 0 && <div className="drawer-tags">{[...place.tags, classification].filter(Boolean).map(tag => <span key={tag}>{tag}</span>)}</div>}{classificationReason && <p className="classification-reason">{classificationReason}</p>}<div className="drawer-links"><a href={buildXiaohongshuSearchUrl(place)} target="_blank" rel="noreferrer">去小红书看评价 <ExternalLink size={13}/></a></div><button className="drawer-navigation" onClick={() => onNavigate(place)}><Navigation size={17}/>打开高德导航<ExternalLink size={15}/></button><p className="drawer-footnote">所有门店均来自高德地点数据；分类标签仅供参考，按摩服务请自行核实。</p></div></aside></div>
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
    try { const result = await fetchNearbyPlaces(nextLocation, controller.signal, requestedRadius, requestedCategory); placesRef.current = result; setPlaces(result); setSelected(current => result.some(place => place.id === current) ? current : result[0]?.id || null); lastSearch.current = [nextLocation.latitude, nextLocation.longitude]; setPlacesStatus(result.length ? 'ready' : 'empty') } catch (error) { if (error.name === 'AbortError') return; setPlacesError(error.message === 'MISSING_AMAP_KEY' ? '未配置高德 Web 服务 Key，无法加载地点。' : '高德地点暂时无法更新，请稍后重试。'); setPlacesStatus(error.message === 'MISSING_AMAP_KEY' ? 'missing-key' : 'error'); placesRef.current = []; setPlaces([]) }
  }, [])

  const applyPosition = useCallback(position => { const next = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, label: '我的实时位置' }; setLocation(next); setLocationStatus('ready'); const previous = lastSearch.current; if (!previous || haversineKm(previous, [next.latitude, next.longitude]) >= .5) loadPlaces(next, radiusRef.current, categoryRef.current) }, [loadPlaces])
  const requestLocation = useCallback(() => { const fallback = () => { setLocation(DEFAULT_LOCATION); loadPlaces(DEFAULT_LOCATION) }; if (!navigator.geolocation) { setLocationStatus('error'); setPlacesError('当前浏览器不支持定位，正在显示默认区域。'); fallback(); return }; setLocationStatus('requesting'); navigator.geolocation.getCurrentPosition(applyPosition, () => { setLocationStatus('denied'); setPlacesError('无法获取当前位置，当前显示默认区域。'); fallback() }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }) }, [applyPosition, loadPlaces])
  const toggleFollowing = () => { if (isFollowing) { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; setIsFollowing(false); return } if (!navigator.geolocation) { setLocationStatus('error'); setPlacesError('当前浏览器不支持实时定位。'); return } setIsFollowing(true); setLocationStatus('requesting'); watchId.current = navigator.geolocation.watchPosition(applyPosition, () => { setLocationStatus('denied'); setIsFollowing(false); setPlacesError('实时定位不可用，当前仍显示默认区域。') }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }) }
  useEffect(() => { requestLocation(); return () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); abortRef.current?.abort() } }, [requestLocation])

  const filters = placeCategory === 'cafe' ? ['全部', '营业中', '4.5+ 评分', '适合学习', '不建议学习', '¥', '¥¥', '¥¥¥'] : placeCategory === 'massage' ? ['全部', '营业中', '信息较完整', '信息较少', '¥', '¥¥', '¥¥¥'] : ['全部', '营业中', '¥', '¥¥', '¥¥¥']
  const visible = useMemo(() => { const list = places.filter(place => (!query || `${place.name}${place.address}${place.category}`.toLowerCase().includes(query.toLowerCase())) && (filter === '全部' || (filter === '营业中' ? place.open === true : filter === '4.5+ 评分' ? place.rating != null && place.rating >= 4.5 : filter === '适合学习' ? place.studySuitability === '适合学习' : filter === '不建议学习' ? place.studySuitability === '不建议学习' : filter === '信息较完整' ? place.massageProfile === '信息较完整' : filter === '信息较少' ? place.massageProfile === '信息较少' : ['¥', '¥¥', '¥¥¥'].includes(filter) ? place.priceLevel === filter : true))); return [...list].sort((a, b) => sort === '距离优先' ? a.distanceKm - b.distanceKm : sort === '评分优先' ? ((b.rating ?? -1) - (a.rating ?? -1)) || a.distanceKm - b.distanceKm : 0) }, [places, query, filter, sort])
  const activeCategory = CATEGORY_OPTIONS.find(option => option.id === placeCategory) || CATEGORY_OPTIONS[0]; const locationLabel = locationStatus === 'requesting' ? '正在获取位置…' : isFollowing ? '实时跟随中' : locationStatus === 'ready' ? '我的位置' : location.label; const dataSourceLabel = '高德实时数据'
  const changeCategory = category => { setPlaceCategory(category); setFilter('全部'); setQuery(''); loadPlaces(location, radiusMeters, category) }; const changeRadius = radius => { setRadiusMeters(radius); loadPlaces(location, radius, placeCategory) }; const toggleFavorite = id => setFavorites(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); const openNavigation = place => openCafeNavigation(place)

  return <main><header className="header"><a className="brand"><span className="brand-mark">R</span><span>ROAST <i>&</i> ROAM</span></a><nav><a className="active">探索门店</a><a>我的收藏 <sup>{favorites.length || ''}</sup></a></nav><div className="location-actions"><button className="location" onClick={requestLocation}><Navigation size={15}/> {locationLabel} <ChevronDown size={14}/></button><button className={`follow-button ${isFollowing ? 'following' : ''}`} onClick={toggleFollowing}><Radio size={15}/>{isFollowing ? '停止跟随' : '实时跟随'}</button></div><button className="mobile-filter"><SlidersHorizontal size={18}/></button></header>
    <section className="hero"><div><p className="eyebrow">YOUR NEXT CUP IS CLOSER THAN YOU THINK</p><h1>马上来<br/><em>一杯</em></h1><p className="hero-subtitle">发现此刻，离你最近的好咖啡。</p></div><div className="hero-note"><span className="vertical-line"/><p>打开定位，<br/>让好味道自己出现。</p></div><div className="hero-orbit" aria-hidden="true"><span>NEARBY</span><strong>{radiusMeters / 1000}<br/><small>KM</small></strong></div></section>
    <section className="workspace"><div className="list-panel"><div className="explore-controls"><div className="category-tabs">{CATEGORY_OPTIONS.map(option => <button key={option.id} className={placeCategory === option.id ? 'active' : ''} onClick={() => changeCategory(option.id)}><span>{option.icon}</span>{option.label}</button>)}</div><div className="radius-tabs"><span>范围</span>{RADIUS_OPTIONS.map(option => <button key={option.meters} className={radiusMeters === option.meters ? 'active' : ''} onClick={() => changeRadius(option.meters)}>{option.label}</button>)}</div></div><div className="location-banner"><div className="location-banner-icon"><LocateFixed size={17}/></div><div><strong>{locationStatus === 'ready' ? `正在探索你附近的${activeCategory.label}` : `发现你附近的${activeCategory.label}`}</strong><span>{locationStatus === 'ready' ? `以 ${locationLabel} 为中心 · ${radiusMeters >= 1000 ? `${radiusMeters / 1000} km` : `${radiusMeters}m`} 范围` : '允许定位后，结果会更贴近你'}</span></div><button onClick={requestLocation}>{locationStatus === 'ready' ? '更新位置' : '使用当前位置'}</button></div><div className="search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${activeCategory.label}名称、街区或关键词...`}/>{query && <button onClick={() => setQuery('')}><X size={16}/></button>}</div><div className="toolbar"><div className="filter-scroll">{filters.map(value => <button key={value} className={filter === value ? 'chosen' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div><button className="sort" onClick={() => setSort(sort === '评分优先' ? '距离优先' : sort === '距离优先' ? '推荐排序' : '评分优先')}><ArrowUpDown size={14}/>{sort}</button></div><div className="result-head"><p><strong>{visible.length}</strong> 家{activeCategory.label}地点</p><span>{placesStatus === 'loading' ? '正在更新…' : placesStatus === 'error' ? '高德请求失败' : placesStatus === 'missing-key' ? '未配置高德 Key' : dataSourceLabel}</span></div>{placesError && <div className="notice error"><AlertCircle size={15}/><span>{placesError}</span><button onClick={() => loadPlaces(location)}><RotateCcw size={14}/></button></div>}<div className="cards">{placesStatus === 'loading' && !places.length ? <div className="empty"><LoaderCircle className="spin" size={25}/><h3>正在寻找附近的{activeCategory.label}</h3><p>正在连接高德实时地点数据。</p></div> : visible.length ? visible.map(place => <CafeCard key={place.id} place={place} selected={selected === place.id} favorite={favorites.includes(place.id)} onSelect={setSelected} onFavorite={toggleFavorite} onNavigate={openNavigation} onDetails={setDetailPlace}/>) : <div className="empty"><Coffee size={25}/><h3>{placesStatus === 'missing-key' ? '需要配置高德 Key' : placesStatus === 'empty' ? '当前范围内没有找到地点' : '高德暂时没有返回结果'}</h3><p>{placesStatus === 'missing-key' ? '请在部署环境中设置 VITE_AMAP_KEY。' : '试试扩大范围、切换分类或重新搜索。'}</p></div>}</div></div><MapView places={visible} selected={selected} onSelect={setSelected} location={location} accuracy={location.accuracy} onLocate={requestLocation}/></section><CafeDetailDrawer place={detailPlace} favorite={detailPlace ? favorites.includes(detailPlace.id) : false} onClose={() => setDetailPlace(null)} onFavorite={toggleFavorite} onNavigate={openNavigation}/>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
