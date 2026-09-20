import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, ArrowUpDown, ChevronDown, Clock3, Coffee, ExternalLink, Heart, ImageOff, LocateFixed, LoaderCircle, MapPin, Navigation, Radio, RotateCcw, Search, Sparkles, Star, X } from 'lucide-react'
import { Circle, MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchNearbyPlaces, haversineKm, configureAmapSearch } from '../shared/amapSearch.js'
import { fetchAmapPlaceDetail, hasAmapPoiId, mergeAmapDetail, configureAmapDetails } from '../shared/amapDetails.js'
import { NOTE_ATTRIBUTES, isStudyFriendly, noteKeyOf, readNotes, updateNote } from '../shared/placeNotes.js'
import { curatedEntryFor, curatedScore, isCurated } from '../shared/curated.js'
import { favoritePlaces, isFavorite, readFavorites, toggleFavorite as toggleFavoriteIn } from '../shared/favorites.js'
import { clusterPlaces } from '../shared/mapClusters.js'
import { isChainPlace } from '../shared/chains.js'
import { formatDistance, locationQuality, placeFacts, recommendationReason, selectFeaturedPlaces } from '../shared/placePresentation.js'
import AmapMap from './AmapMap.jsx'
import { hasAmapJsConfig, locatePrecisely, startPreciseWatch } from './amapClient.js'
import './styles.css'

// 平台注入：环境变量只在这里读一次，交给逻辑层。逻辑层不读 import.meta.env，
// 因此同一份检索逻辑可以原样搬到小程序（那边入口换成 wx.request 与 wx 存储即可）。
configureAmapSearch({ key: import.meta.env.VITE_AMAP_KEY || '', proxyUrl: import.meta.env.VITE_AMAP_PROXY || '' })
configureAmapDetails({ proxyUrl: import.meta.env.VITE_AMAP_DETAIL_PROXY || '' })

const DEFAULT_RADIUS_METERS = 500
const DEFAULT_CATEGORY = 'cafe'
const RADIUS_OPTIONS = [{ label: '500m', meters: 500 }, { label: '1km', meters: 1000 }, { label: '2km', meters: 2000 }, { label: '5km', meters: 5000 }]
const CATEGORY_OPTIONS = [{ id: 'cafe', label: '咖啡', icon: '☕' }, { id: 'massage', label: '按摩', icon: '✦' }]
const LOCATION_REFRESH_DISTANCE_KM = 0.1
const LOCATION_ACCURACY_WARNING_METERS = 120
const FOLLOW_REFRESH_INTERVAL_MS = 15000

function buildAmapNavigationUrl(place) { const [latitude, longitude] = place.position; return `https://uri.amap.com/marker?${new URLSearchParams({ position: `${longitude},${latitude}`, name: place.name, src: 'roast-roam', callnative: '1' })}` }
function buildXiaohongshuSearchUrl(place) { return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(`${place.name} ${place.category}`)}` }
// 高德自己的门店页（实测 HTTP 200）。评价正文与更多图片高德不通过 API 提供，但它的网页上有，
// 所以把「看评价」这件事零成本外包出去，不消耗我们的接口配额。
function buildAmapPlaceUrl(place) { return `https://www.amap.com/place/${place.amapPoiId}` }
// POI id 判定统一走 ./amapDetails 的 hasAmapPoiId（高德 id 形如 B0L0LM8N6M；
// 我们兜底生成的「名称+坐标」id 拼出来的链接会 404）
// 高德偶尔返回 0.4、1.7 这种极低分，直接显示成「0.4 分 + 0 颗星」看起来像页面坏了
const RELIABLE_RATING_MIN = 2
function openCafeNavigation(place) { window.open(buildAmapNavigationUrl(place), '_blank', 'noopener,noreferrer') }

function Stars({ value }) { if (value == null) return <span className="no-rating">暂无评分</span>; return <span className="stars" aria-label={`${value} 分`}>{[0,1,2,3,4].map(index => <Star key={index} size={13} fill={index < Math.round(value) ? 'currentColor' : 'none'} />)}</span> }

// 评分展示统一走这里：正常显示分数+星星，极低分显示「评分较少」而不是渲染出 0 颗星的怪样子
function Rating({ value }) {
  if (value == null) return <span className="no-rating">暂无评分</span>
  if (value < RELIABLE_RATING_MIN) return <span className="no-rating" title={`高德评分 ${value.toFixed(1)}`}>评分较少</span>
  return <><strong>{value.toFixed(1)}</strong><Stars value={value}/></>
}

// 高德一次会给多张门店图，之前只显示了第一张。这里做成可切换的画廊。
function PhotoGallery({ photos = [], name }) {
  const [index, setIndex] = useState(0)
  if (!photos.length) return <div className="drawer-placeholder"><ImageOff size={30}/><span>暂无门店图片</span></div>
  const current = Math.min(index, photos.length - 1)
  return <>{photos.length > 1 && <span className="photo-count">{current + 1} / {photos.length}</span>}<img src={photos[current]} alt={`${name}门店照片`} width="920" height="620"/>{photos.length > 1 && <div className="photo-strip">{photos.map((url, position) => <button key={url} className={position === current ? 'active' : ''} onClick={() => setIndex(position)} aria-label={`查看第 ${position + 1} 张图片`}><img src={url} alt="" width="80" height="80" loading="lazy"/></button>)}</div>}</>
}

function PlaceImage({ place, eager = false }) {
  const [failed, setFailed] = useState(false)
  if (!place.image || failed) return <div className="image-placeholder"><Coffee size={27}/><span>{place.category === '按摩店' ? '松' : '醒'}</span></div>
  return <img src={place.image} alt={`${place.name}门店照片`} width="640" height="480" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} onError={() => setFailed(true)}/>
}

function openCardWithKeyboard(event, action) {
  if (event.target !== event.currentTarget && event.target.closest('button, a, input')) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

function CafeCard({ place, selected, favorite, note, onSelect, onFavorite, onNavigate, onDetails }) {
  const status = place.open === true ? '营业中' : place.open === false ? '已打烊' : null
  const classification = place.studySuitability && place.studySuitability !== '未判断' ? place.studySuitability : place.massageProfile
  const facts = placeFacts(place)
  const openDetails = () => { onSelect(place.id); onDetails(place) }
  return <article className={`cafe-card ${selected ? 'selected' : ''}`} role="button" tabIndex="0" aria-label={`查看 ${place.name} 详情`} onClick={openDetails} onKeyDown={event => openCardWithKeyboard(event, openDetails)}>
    <div className="card-image">
      <PlaceImage place={place}/>
      <button className={`heart ${favorite ? 'liked' : ''}`} onClick={event => { event.stopPropagation(); onFavorite(place) }} aria-label={favorite ? '取消收藏' : '收藏门店'}><Heart size={16} fill={favorite ? 'currentColor' : 'none'}/></button>
      {status && <span className={`open-pill ${place.open === false ? 'closed' : ''}`}>{status}</span>}
    </div>
    <div className="card-copy">
      <div className="card-top"><div><h3>{place.name}</h3><p>{place.address}</p></div><div className="rating"><Rating value={place.rating}/></div></div>
      <p className="card-reason">{recommendationReason(place, isCurated(place))}</p>
      <div className="card-meta">{facts.map(fact => <span key={fact}>{fact}</span>)}</div>
      <div className="tags">{note && <span className="tag-mine">{isStudyFriendly(note) ? '我标记：适合学习' : note.verdict === 'bad' ? '我标记：不适合' : '我有备注'}</span>}{isCurated(place) && <span className="tag-curated">口碑推荐</span>}{isChainPlace(place) && <span className="tag-chain">连锁</span>}{[...place.tags, classification].filter(Boolean).slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</div>
      <div className="card-actions"><button className="details-button" onClick={event => { event.stopPropagation(); onDetails(place) }}>查看详情</button><button className="nav-button" onClick={event => { event.stopPropagation(); onNavigate(place) }}><Navigation size={13}/>去这里</button></div>
    </div>
  </article>
}

function FeaturedPlaces({ items, onDetails, onNavigate }) {
  if (!items.length) return null
  return <section className="featured-section" aria-labelledby="featured-heading">
    <div className="section-heading"><div><span><Sparkles size={14}/>今天去哪</span><h2 id="featured-heading">附近值得点开的选择</h2></div><p>只根据真实距离和公开门店信息推荐</p></div>
    <div className="featured-grid">{items.map(({ place, label }, index) => <article className="featured-card" role="button" tabIndex="0" aria-label={`查看 ${place.name} 详情`} key={place.id} onClick={() => onDetails(place)} onKeyDown={event => openCardWithKeyboard(event, () => onDetails(place))}>
      <div className="featured-image"><PlaceImage place={place} eager={index === 0}/><span>{label}</span></div>
      <div className="featured-copy"><h3>{place.name}</h3><p>{recommendationReason(place, isCurated(place))}</p><div>{placeFacts(place).map(fact => <span key={fact}>{fact}</span>)}</div><button onClick={event => { event.stopPropagation(); onNavigate(place) }}><Navigation size={14}/>去这里</button></div>
    </article>)}</div>
  </section>
}

// 「我的标记」：高德不提供「适合学习」这类字段，这是唯一真实可信的来源。
// 数据只存在本机浏览器，不上传，所以不做登录也不涉及隐私收集。
function MyNoteEditor({ place, note, onChange }) {
  const verdict = note?.verdict || null
  const attributes = note?.attributes || []
  const toggleAttribute = id => onChange({ attributes: attributes.includes(id) ? attributes.filter(value => value !== id) : [...attributes, id] })
  return <section className="my-note">
    <div className="my-note-head"><strong>我的标记</strong><span>只存在这台设备上，不会上传</span></div>
    <div className="my-note-verdict">
      <button className={`verdict ${verdict === 'good' ? 'active good' : ''}`} onClick={() => onChange({ verdict: verdict === 'good' ? null : 'good' })}>适合学习</button>
      <button className={`verdict ${verdict === 'bad' ? 'active bad' : ''}`} onClick={() => onChange({ verdict: verdict === 'bad' ? null : 'bad' })}>不适合</button>
      {note && <button className="clear" onClick={() => onChange({ verdict: null, attributes: [], note: '' })}>清除</button>}
    </div>
    <div className="my-note-attrs">{NOTE_ATTRIBUTES.map(attribute => <button key={attribute.id} className={attributes.includes(attribute.id) ? 'active' : ''} onClick={() => toggleAttribute(attribute.id)}>{attribute.label}</button>)}</div>
    <input className="my-note-input" value={note?.note || ''} maxLength={200} onChange={event => onChange({ note: event.target.value })} placeholder="备注：靠窗有位、插座多、下午很安静…"/>
  </section>
}

// 口碑推荐：人工策展的加分项。数据来源与格式见 ./curated.js。没有记录就整块不渲染。
function CuratedNote({ place }) {
  const entry = curatedEntryFor(place)
  if (!entry) return null
  return <section className="curated-note">
    <div className="curated-head">
      <span className="tag-curated">口碑推荐</span>
      {entry.score != null && <strong>{entry.score}</strong>}
      {entry.score != null && <span className="curated-max">/ 10</span>}
    </div>
    {entry.note && <p className="curated-text">{entry.note}</p>}
    <p className="curated-source">来源：{entry.source}</p>
  </section>
}

function CafeDetailDrawer({ place, favorite, note, detailStatus, onClose, onFavorite, onNavigate, onNoteChange }) {
  const closeRef = useRef(null)
  useEffect(() => {
    if (!place) return undefined
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = event => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [place, onClose])
  if (!place) return null
  const status = place.open === true ? '营业中' : place.open === false ? '已打烊' : null
  const classification = place.studySuitability && place.studySuitability !== '未判断' ? place.studySuitability : place.massageProfile
  const classificationReason = place.studyReason || place.massageReason
  const onlineFacts = [
    ['今日营业', place.todayHours],
    ['电话', place.tel],
    ['商圈', place.businessArea],
    ['楼层', place.floor],
    ['入口导航', place.hasEntrance ? '已提供' : null]
  ].filter(([, value]) => value)

  return <div className="drawer-backdrop" onClick={onClose}>
    <aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="place-detail-title" onClick={event => event.stopPropagation()}>
      <button ref={closeRef} className="drawer-close" onClick={onClose} aria-label="关闭门店详情"><X size={19}/></button>
      <div className="drawer-photo">
        <PhotoGallery photos={place.photos?.length ? place.photos : (place.image ? [place.image] : [])} name={place.name}/>
        {status && <span className={`open-pill ${place.open === false ? 'closed' : ''}`}>{status}</span>}
      </div>
      <div className="drawer-content">
        <div className="drawer-kicker">AMAP PLACE</div>
        {detailStatus === 'loading' && <p className="detail-status"><LoaderCircle className="spin" size={14}/>正在补充高德公开信息</p>}
        {detailStatus === 'error' && <p className="detail-status error"><AlertCircle size={14}/>详情暂时不可用，已保留基础信息</p>}
        <div className="drawer-title-row">
          <div><h2 id="place-detail-title">{place.name}</h2><p>{place.address}</p></div>
          <button className={`heart drawer-heart ${favorite ? 'liked' : ''}`} onClick={() => onFavorite(place)}><Heart size={17} fill={favorite ? 'currentColor' : 'none'}/></button>
        </div>
        <div className="drawer-rating"><Rating value={place.rating}/><span>{place.reviews ? `${place.reviews} 条评价` : place.rating == null ? '暂无评分' : '高德评分'}</span></div>
        <div className="drawer-facts">
          <span><Navigation size={15}/>{formatDistance(place.distanceKm)}</span>
          <span><Clock3 size={15}/>{place.openingHours || '营业时间待确认'}</span>
          <span className="price-fact"><Coffee size={15}/>{place.priceLabel ? `参考 ${place.priceLabel}` : '价格待确认'}</span>
        </div>
        {onlineFacts.length > 0 && <dl className="online-facts">{onlineFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        {(place.tags.length || classification || place.alias) > 0 && <div className="drawer-tags">{[...place.tags, classification, place.alias].filter(Boolean).map(tag => <span key={tag}>{tag}</span>)}</div>}
        {classificationReason && <p className="classification-reason">{classificationReason}</p>}
        <CuratedNote place={place}/><MyNoteEditor place={place} note={note} onChange={patch => onNoteChange(place, patch)}/>
        <div className="drawer-links">
          <a href={buildXiaohongshuSearchUrl(place)} target="_blank" rel="noreferrer">去小红书看评价 <ExternalLink size={13}/></a>
          {hasAmapPoiId(place.amapPoiId) && <a href={buildAmapPlaceUrl(place)} target="_blank" rel="noreferrer">在高德看门店图片与评价 <ExternalLink size={13}/></a>}
        </div>
        <div className="drawer-sticky-actions"><button className={`drawer-save ${favorite ? 'liked' : ''}`} onClick={() => onFavorite(place)}><Heart size={16} fill={favorite ? 'currentColor' : 'none'}/>{favorite ? '已收藏' : '收藏'}</button><button className="drawer-navigation" onClick={() => onNavigate(place)}><Navigation size={17}/>打开高德导航<ExternalLink size={15}/></button></div>
        <p className="drawer-footnote">门店公开信息来自高德；评价正文由高德门店页展示，本站不存储。</p>
      </div>
    </aside>
  </div>
}

function Recenter({ center, onLocate }) { const map = useMap(); useEffect(() => { map.flyTo(center, 14, { duration: .7 }) }, [center, map]); return <button className="recenter" title="回到当前位置" aria-label="回到当前位置" onClick={() => { map.flyTo(center, 14); onLocate?.() }}><LocateFixed size={16}/></button> }
function markerIcon(place, active) { return L.divIcon({ className: 'custom-marker-wrap', html: `<div class="custom-marker ${active ? 'active' : ''}" style="--marker:${place.color}"><span>${place.rating == null ? '•' : place.rating}</span></div>`, iconSize: [active ? 48 : 39, active ? 48 : 39], iconAnchor: [active ? 24 : 19, active ? 46 : 37], popupAnchor: [0, -38] }) }

// 地图标记聚合图标：显示「这一格里有几家」，放大后会自动散开成单个门店标记
function clusterIcon(cluster, active) {
  const size = active ? 54 : 46
  return L.divIcon({
    className: 'custom-marker-wrap',
    html: `<div class="cluster-marker ${active ? 'active' : ''}" style="--marker:${cluster.place.color}"><span>${cluster.count}<small>家</small></span></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2]
  })
}

function PlaceMarkers({ places, selected, onSelect }) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useEffect(() => {
    const syncZoom = () => setZoom(map.getZoom())
    map.on('zoomend', syncZoom)
    return () => map.off('zoomend', syncZoom)
  }, [map])
  const clusters = useMemo(() => clusterPlaces(places, zoom).map(cluster => {
    // 列表里选中的那家若在聚合内但不是代表项，就把代表项换成它，否则地图上看不到高亮
    const selectedMember = cluster.places.find(place => place.id === selected)
    return selectedMember ? { ...cluster, place: selectedMember } : cluster
  }), [places, zoom, selected])

  return clusters.map(cluster => cluster.count > 1
    ? <Marker key={cluster.key} position={cluster.center} icon={clusterIcon(cluster, cluster.place.id === selected)} eventHandlers={{ click: () => onSelect(cluster.place.id) }}><Popup><strong>{cluster.place.name}</strong><br/><span>这附近共 {cluster.count} 家，放大可分开显示</span><br/><a className="popup-nav" href={buildAmapNavigationUrl(cluster.place)} target="_blank" rel="noreferrer">打开高德导航 →</a></Popup></Marker>
    : <Marker key={cluster.key} position={cluster.place.position} icon={markerIcon(cluster.place, cluster.place.id === selected)} eventHandlers={{ click: () => onSelect(cluster.place.id) }}><Popup><strong>{cluster.place.name}</strong><br/><span>{cluster.place.rating == null ? '暂无评分' : `★ ${cluster.place.rating}`} · {cluster.place.distanceKm.toFixed(1)} km</span><br/><a className="popup-nav" href={buildAmapNavigationUrl(cluster.place)} target="_blank" rel="noreferrer">打开高德导航 →</a></Popup></Marker>)
}

function LegacyMapView({ places, selected, onSelect, location, accuracy, onLocate }) {  const center = useMemo(() => location ? [location.latitude, location.longitude] : [0, 0], [location?.latitude, location?.longitude])
  if (!location) return <div className="map-wrap real-map map-placeholder"><div><LocateFixed size={28}/><strong>开启定位后显示附近地图</strong><span>未获取真实位置，不会请求其他区域</span><button onClick={onLocate}>使用当前位置</button></div></div>
  return <div className="map-wrap real-map"><MapContainer center={center} zoom={14} zoomControl={false} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><ZoomControl position="topright"/><Recenter center={center} onLocate={onLocate}/><Circle center={center} radius={accuracy || 40} pathOptions={{ color: '#287f68', fillColor: '#75b39f', fillOpacity: .12, weight: 1 }}/><Marker position={center} icon={L.divIcon({ className: 'user-location-wrap', html: '<div class="user-location-dot"></div>', iconSize: [18,18], iconAnchor: [9,9] })}/><PlaceMarkers places={places} selected={selected} onSelect={onSelect}/></MapContainer><div className="map-caption"><MapPin size={15}/><span>{location.label || '当前位置'}</span><span>{places.length} 家</span><span>配置高德 JS Key 后启用精准底图</span></div></div>
}

function MapView(props) {
  if (!props.location || !hasAmapJsConfig()) return <LegacyMapView {...props}/>
  return <AmapMap {...props}/>
}

function App() {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('全部'); const [sort, setSort] = useState('距离优先'); const [radiusMeters, setRadiusMeters] = useState(DEFAULT_RADIUS_METERS); const [placeCategory, setPlaceCategory] = useState(DEFAULT_CATEGORY)
  const [selected, setSelected] = useState(null); const [detailPlace, setDetailPlace] = useState(null); const [favorites, setFavorites] = useState(() => readFavorites()); const [viewMode, setViewMode] = useState('explore'); const [location, setLocation] = useState(null); const [locationStatus, setLocationStatus] = useState('idle'); const [isFollowing, setIsFollowing] = useState(false); const [places, setPlaces] = useState([]); const [placesStatus, setPlacesStatus] = useState('location-required'); const [placesError, setPlacesError] = useState('')
  const [notes, setNotes] = useState(() => readNotes())
  const setPlaceNote = useCallback((place, patch) => setNotes(current => updateNote(current, noteKeyOf(place), patch)), [])

  // 打开抽屉时补拉一次高德 POI 详情（今日营业时间、电话、商圈、别名、更多图片、入口导航）。
  // 失败只降级提示，基础信息照常显示 —— 详情是增强项，不能因为它是坏的就连列表都看不了。
  const [detailState, setDetailState] = useState({ id: null, status: 'idle', detail: null })
  useEffect(() => {
    if (!detailPlace) { setDetailState({ id: null, status: 'idle', detail: null }); return undefined }
    if (!hasAmapPoiId(detailPlace.amapPoiId)) { setDetailState({ id: detailPlace.id, status: 'unavailable', detail: null }); return undefined }
    const controller = new AbortController()
    setDetailState({ id: detailPlace.id, status: 'loading', detail: null })
    fetchAmapPlaceDetail(detailPlace.amapPoiId, controller.signal)
      .then(detail => {
        if (controller.signal.aborted) return
        setDetailState({ id: detailPlace.id, status: 'ready', detail })
        setPlaces(current => {
          const next = current.map(place => place.id === detailPlace.id ? mergeAmapDetail(place, detail) : place)
          placesRef.current = next
          return next
        })
      })
      .catch(error => { if (error.name !== 'AbortError' && !controller.signal.aborted) setDetailState({ id: detailPlace.id, status: 'error', detail: null }) })
    return () => controller.abort()
  }, [detailPlace])
  const drawerPlace = detailPlace ? mergeAmapDetail(detailPlace, detailState.id === detailPlace.id ? detailState.detail : null) : null
  const drawerDetailStatus = detailPlace && detailState.id === detailPlace.id ? detailState.status : 'idle'
  const stopWatchRef = useRef(null); const lastSearch = useRef(null); const lastSearchAt = useRef(0); const abortRef = useRef(null); const placesRef = useRef([]); const radiusRef = useRef(DEFAULT_RADIUS_METERS); const categoryRef = useRef(DEFAULT_CATEGORY)
  radiusRef.current = radiusMeters; categoryRef.current = placeCategory

  const loadPlaces = useCallback(async (nextLocation, requestedRadius = radiusRef.current, requestedCategory = categoryRef.current) => {
    if (!nextLocation) return
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller; setPlacesStatus('loading'); setPlacesError('')
    const applyResults = (result, final) => { placesRef.current = result; setPlaces(result); setSelected(current => result.some(place => place.id === current) ? current : result[0]?.id || null); if (final) { lastSearch.current = [nextLocation.latitude, nextLocation.longitude]; lastSearchAt.current = Date.now(); setPlacesStatus(result.length ? 'ready' : 'empty') } }
    try { const result = await fetchNearbyPlaces(nextLocation, controller.signal, requestedRadius, requestedCategory, partial => { if (!controller.signal.aborted) applyResults(partial, false) }); applyResults(result, true) } catch (error) { if (error.name === 'AbortError') return; const quotaExhausted = error.infocode === '10003' || error.infocode === '10044'; const proxyDown = error.code === 'PROXY_UNAVAILABLE'; setPlacesError(error.message === 'MISSING_AMAP_KEY' ? '未配置高德 Web 服务 Key，无法加载地点。' : proxyDown ? '服务端检索接口暂时不可用，请稍后重试。' : quotaExhausted ? '高德调用配额已用尽（日/月额度），暂时无法获取新数据。' : '高德地点暂时无法更新，请稍后重试。'); setPlacesStatus(error.message === 'MISSING_AMAP_KEY' ? 'missing-key' : 'error'); placesRef.current = []; setPlaces([]) }
  }, [])

  const clearLocationData = useCallback(message => { abortRef.current?.abort(); lastSearch.current = null; placesRef.current = []; setLocation(null); setSelected(null); setPlaces([]); setPlacesStatus('location-required'); setLocationStatus('denied'); setPlacesError(message) }, [])
  const applyLocation = useCallback((next, { force = false } = {}) => {
    setLocation(next)
    setLocationStatus('ready')
    setPlacesError(next.isApproximate || (next.accuracy && next.accuracy > LOCATION_ACCURACY_WARNING_METERS) ? '当前位置精度较低，可点击地图或拖动图钉校准。' : '')
    const previous = lastSearch.current
    const movedEnough = !previous || haversineKm(previous, [next.latitude, next.longitude]) >= LOCATION_REFRESH_DISTANCE_KM
    const intervalPassed = Date.now() - lastSearchAt.current >= FOLLOW_REFRESH_INTERVAL_MS
    if (force || (movedEnough && intervalPassed)) loadPlaces(next, radiusRef.current, categoryRef.current)
  }, [loadPlaces])
  const applyBrowserPosition = useCallback(position => {
    const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null
    applyLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy, source: 'html5', label: '我的实时位置', address: '', coordinateSystem: 'wgs84', isApproximate: !Number.isFinite(accuracy) }, { force: !lastSearch.current })
  }, [applyLocation])
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { clearLocationData('当前浏览器不支持定位，请使用支持定位的 HTTPS 浏览器。'); return }
    abortRef.current?.abort(); lastSearch.current = null; lastSearchAt.current = 0; setLocationStatus('requesting'); setPlacesError('')
    const onError = error => { const message = error?.code === 1 ? '请允许浏览器使用当前位置，才能加载附近地点。' : '暂时无法获取当前位置，请重试或在地图上选点。'; clearLocationData(message) }
    if (hasAmapJsConfig()) locatePrecisely().then(next => applyLocation(next, { force: true })).catch(onError)
    else navigator.geolocation.getCurrentPosition(applyBrowserPosition, onError, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  }, [applyBrowserPosition, applyLocation, clearLocationData])
  const stopFollowing = useCallback(() => { stopWatchRef.current?.(); stopWatchRef.current = null; setIsFollowing(false) }, [])
  const toggleFollowing = async () => {
    if (isFollowing) { stopFollowing(); return }
    if (!navigator.geolocation) { clearLocationData('当前浏览器不支持实时定位。'); return }
    setIsFollowing(true); setLocationStatus('requesting')
    const onError = () => { stopFollowing(); setLocationStatus(location ? 'ready' : 'denied'); setPlacesError(location ? '实时定位暂时中断，当前保留上一次位置结果。' : '无法获取当前位置，请允许定位后重试。') }
    try {
      if (hasAmapJsConfig()) stopWatchRef.current = await startPreciseWatch(applyLocation, onError)
      else {
        const id = navigator.geolocation.watchPosition(applyBrowserPosition, onError, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 })
        stopWatchRef.current = () => navigator.geolocation.clearWatch(id)
      }
    } catch (error) { onError(error) }
  }
  useEffect(() => { requestLocation(); return () => { stopWatchRef.current?.(); abortRef.current?.abort() } }, [requestLocation])

  const filters = placeCategory === 'cafe' ? ['全部', '营业中', '有图片', '口碑推荐', '我标记适合', '4.5+ 评分', '高德推断适合', '高德推断不适合', '只看独立店', '¥', '¥¥', '¥¥¥'] : ['全部', '营业中', '有图片', '口碑推荐', '信息较完整', '信息较少', '¥', '¥¥', '¥¥¥']
  const visible = useMemo(() => { const reputationCache = new Map(); const reputationScore = place => { if (!reputationCache.has(place.id)) reputationCache.set(place.id, curatedScore(place) ?? -1); return reputationCache.get(place.id) }; const source = viewMode === 'favorites' ? favoritePlaces(favorites, location) : places; const list = source.filter(place => (!query || `${place.name}${place.address}${place.category}${place.tags.join('')}`.toLowerCase().includes(query.toLowerCase())) && (filter === '全部' || (filter === '营业中' ? place.open === true : filter === '有图片' ? Boolean(place.image) : filter === '4.5+ 评分' ? place.rating != null && place.rating >= 4.5 : filter === '我标记适合' ? isStudyFriendly(notes[noteKeyOf(place)]) : filter === '高德推断适合' ? place.studySuitability === '适合学习' : filter === '高德推断不适合' ? place.studySuitability === '不建议学习' : filter === '信息较完整' ? place.massageProfile === '信息较完整' : filter === '信息较少' ? place.massageProfile === '信息较少' : ['¥', '¥¥', '¥¥¥'].includes(filter) ? place.priceLevel === filter : filter === '只看独立店' ? !isChainPlace(place) : filter === '口碑推荐' ? isCurated(place) : true))); return [...list].sort((a, b) => sort === '距离优先' ? a.distanceKm - b.distanceKm : sort === '评分优先' ? ((b.rating ?? -1) - (a.rating ?? -1)) || a.distanceKm - b.distanceKm : reputationScore(b) - reputationScore(a) || ((b.rating ?? -1) - (a.rating ?? -1)) || a.distanceKm - b.distanceKm) }, [places, query, filter, sort, notes, viewMode, favorites, location])
  const featured = useMemo(() => viewMode === 'explore' ? selectFeaturedPlaces(visible, 3, isCurated) : [], [visible, viewMode])
  const activeCategory = CATEGORY_OPTIONS.find(option => option.id === placeCategory) || CATEGORY_OPTIONS[0]
  const quality = locationQuality(location)
  const locationLabel = locationStatus === 'requesting' ? '正在获取位置…' : isFollowing ? '实时跟随中' : locationStatus === 'ready' ? quality.label : '等待定位'
  const dataSourceLabel = location ? '高德实时数据' : '等待真实位置'
  const locationMessage = location ? `${location.address || location.label || '当前位置'} · ${quality.label} · 仅查询 ${radiusMeters >= 1000 ? `${radiusMeters / 1000} km` : `${radiusMeters} m`} 内` : '未获取真实位置，不会请求其他区域'
  const locationRequired = placesStatus === 'location-required'
  const retryPlaces = locationRequired ? requestLocation : () => loadPlaces(location)
  const changeCategory = category => { setPlaceCategory(category); setFilter('全部'); setQuery(''); if (location) loadPlaces(location, radiusMeters, category) }
  const changeRadius = radius => { setRadiusMeters(radius); if (location) loadPlaces(location, radius, placeCategory) }
  const toggleFavoritePlace = place => setFavorites(current => toggleFavoriteIn(current, place))
  const openNavigation = place => openCafeNavigation(place)
  const closeDetails = useCallback(() => setDetailPlace(null), [])
  const useManualLocation = next => { lastSearch.current = null; lastSearchAt.current = 0; applyLocation(next, { force: true }) }

  const heroTitle = location ? (placeCategory === 'cafe' ? '离你最近的一杯，几步就到。' : '离你最近的一次放松，几步就到。') : '先找到你，再找附近的好去处。'

  return <main data-category={placeCategory}><a className="skip-link" href="#main-content">跳到门店列表</a><header className="header"><div className="brand"><span className="brand-mark">半</span><span>半醒半松</span></div><nav aria-label="主要导航"><button className={viewMode === 'explore' ? 'active' : ''} onClick={() => setViewMode('explore')}>探索门店</button><button className={viewMode === 'favorites' ? 'active' : ''} onClick={() => setViewMode('favorites')}>我的收藏 <sup>{Object.keys(favorites).length || ''}</sup></button></nav><div className="location-actions"><button className="location" onClick={requestLocation}><Navigation size={15}/>{locationLabel}<ChevronDown size={14}/></button><button className={`follow-button ${isFollowing ? 'following' : ''}`} onClick={toggleFollowing}><Radio size={15}/>{isFollowing ? '停止跟随' : '实时跟随'}</button></div></header>
    <section className="hero"><div><h1>{heroTitle}</h1><p className="hero-subtitle">真实位置，真实距离，只看你身边。</p></div><div className={`hero-location ${quality.level}`}><LocateFixed size={19}/><div><strong>{locationStatus === 'requesting' ? '正在校准位置' : location ? locationLabel : '等待位置权限'}</strong><span>{location && places[0] ? `${formatDistance(places[0].distanceKm)} 到最近门店` : location ? '正在查找附近门店' : '开启后才会查询附近门店'}</span></div></div></section>
    <section id="main-content" className="workspace"><div className="list-panel"><FeaturedPlaces items={featured} onDetails={setDetailPlace} onNavigate={openNavigation}/><div className="explore-controls"><div className="category-tabs">{CATEGORY_OPTIONS.map(option => <button key={option.id} className={placeCategory === option.id ? 'active' : ''} onClick={() => changeCategory(option.id)}><span>{option.icon}</span>{option.label}</button>)}</div><div className="radius-tabs"><span>搜索范围</span>{RADIUS_OPTIONS.map(option => <button key={option.meters} className={radiusMeters === option.meters ? 'active' : ''} onClick={() => changeRadius(option.meters)}>{option.label}</button>)}</div></div><div className={`location-banner ${quality.level}`}><div className="location-banner-icon"><LocateFixed size={17}/></div><div><strong>{location ? `正在探索你附近的${activeCategory.label}` : locationStatus === 'requesting' ? '正在获取当前位置' : '请先开启位置权限'}</strong><span>{locationMessage}</span></div><button onClick={requestLocation}>{location ? '重新校准' : '使用当前位置'}</button></div><div className="search"><Search size={18}/><input name="place-search" aria-label={`搜索${activeCategory.label}名称、街区或关键词`} autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${activeCategory.label}名称、街区或关键词…`}/>{query && <button onClick={() => setQuery('')} aria-label="清空搜索"><X size={16}/></button>}</div><div className="toolbar"><div className="filter-scroll">{filters.map(value => <button key={value} className={filter === value ? 'chosen' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div><button className="sort" onClick={() => setSort(sort === '距离优先' ? '评分优先' : sort === '评分优先' ? '口碑优先' : '距离优先')}><ArrowUpDown size={14}/>{sort}</button></div><div className="result-head"><p><strong>{visible.length}</strong> {viewMode === 'favorites' ? '家收藏门店' : `家${activeCategory.label}地点`}</p><span aria-live="polite">{placesStatus === 'loading' ? '正在更新…' : placesStatus === 'error' ? '高德请求失败' : placesStatus === 'missing-key' ? '未配置高德 Key' : dataSourceLabel}</span></div>{placesError && <div className="notice error" role="status"><AlertCircle size={15}/><span>{placesError}</span><button onClick={retryPlaces} aria-label="重新加载"><RotateCcw size={14}/></button></div>}<div className="cards">{placesStatus === 'loading' && !places.length && viewMode === 'explore' ? <div className="empty"><LoaderCircle className="spin" size={25}/><h3>正在寻找附近的{activeCategory.label}</h3><p>只请求当前位置附近的数据。</p></div> : visible.length ? visible.map(place => <CafeCard key={place.id} place={place} selected={selected === place.id} favorite={isFavorite(favorites, place)} note={notes[noteKeyOf(place)]} onSelect={setSelected} onFavorite={toggleFavoritePlace} onNavigate={openNavigation} onDetails={setDetailPlace}/>) : <div className="empty"><Coffee size={25}/><h3>{locationRequired ? '请先开启定位' : placesStatus === 'missing-key' ? '需要配置高德 Key' : placesStatus === 'empty' ? `当前 ${radiusMeters >= 1000 ? `${radiusMeters / 1000} km` : `${radiusMeters} m`} 内没有找到地点` : viewMode === 'favorites' ? '还没有收藏任何门店' : '高德暂时没有返回结果'}</h3><p>{locationRequired ? '允许定位后，只会查询你当前位置附近的地点。' : placesStatus === 'missing-key' ? '请在部署环境中设置 VITE_AMAP_KEY。' : '可以扩大范围后重新搜索。'}</p></div>}</div></div><MapView places={visible} selected={selected} onSelect={setSelected} location={location} accuracy={location?.accuracy} onLocate={requestLocation} onManualLocation={useManualLocation}/></section><CafeDetailDrawer place={drawerPlace} favorite={isFavorite(favorites, drawerPlace)} note={drawerPlace ? notes[noteKeyOf(drawerPlace)] : undefined} detailStatus={drawerDetailStatus} onClose={closeDetails} onFavorite={toggleFavoritePlace} onNavigate={openNavigation} onNoteChange={setPlaceNote}/>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
