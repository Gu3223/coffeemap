import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Search, Navigation, Heart, SlidersHorizontal, ChevronDown, MapPin, Coffee, Star, X, ArrowUpDown } from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './styles.css'

const cafes = [
  { id:'1', name:'Owl & Finch', address:'17th Street · LoDo', rating:4.9, reviews:218, distance:0.4, open:true, category:'手冲咖啡', tags:['安静工作','自烘焙'], image:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=900&q=80', position:[39.7507,-104.9952], color:'#c46c42' },
  { id:'2', name:'Morrow Coffee', address:'Larimer Square', rating:4.8, reviews:164, distance:0.7, open:true, category:'精品咖啡', tags:['露台','燕麦奶'], image:'https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=900&q=80', position:[39.7477,-104.9971], color:'#d09b38' },
  { id:'3', name:'Stella Roasters', address:'Curtis Park · 28th Ave', rating:4.7, reviews:96, distance:1.1, open:false, category:'深烘焙', tags:['早餐','咖啡豆'], image:'https://images.unsplash.com/photo-1498804103079-a6351b050096?w=900&q=80', position:[39.7612,-104.9816], color:'#8d6b55' },
  { id:'4', name:'Little Owl Café', address:'Five Points · Welton St', rating:4.6, reviews:87, distance:1.4, open:true, category:'奶咖', tags:['宠物友好','甜点'], image:'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=900&q=80', position:[39.7548,-104.9778], color:'#a36b4c' },
  { id:'5', name:'Juniper & Co.', address:'Capitol Hill · 13th Ave', rating:4.5, reviews:72, distance:1.8, open:true, category:'冷萃', tags:['自然酒','夜间营业'], image:'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=900&q=80', position:[39.7355,-104.9851], color:'#70806a' },
]

function Stars({ value }) { return <span className="stars" aria-label={`${value} 分`}>{[0,1,2,3,4].map(i=><Star key={i} size={13} fill={i < Math.round(value) ? 'currentColor' : 'none'} />)}</span> }

function CafeCard({ cafe, selected, favorite, onSelect, onFavorite }) {
  return <article className={`cafe-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(cafe.id)}>
    <div className="card-image"><img src={cafe.image} alt=""/><button className={`heart ${favorite ? 'liked' : ''}`} onClick={e=>{e.stopPropagation();onFavorite(cafe.id)}} aria-label="收藏"><Heart size={16} fill={favorite ? 'currentColor' : 'none'}/></button><span className={`open-pill ${cafe.open ? '' : 'closed'}`}>{cafe.open ? '营业中' : '已打烊'}</span></div>
    <div className="card-copy"><div className="card-top"><div><h3>{cafe.name}</h3><p>{cafe.address}</p></div><div className="rating"><strong>{cafe.rating}</strong><Stars value={cafe.rating}/></div></div><div className="card-meta"><span><Navigation size={13}/>{cafe.distance} km</span><span><Coffee size={13}/>{cafe.category}</span></div><div className="tags">{cafe.tags.map(tag=><span key={tag}>{tag}</span>)}</div></div>
  </article>
}

function Recenter({ center }) { const map = useMap(); return <button className="recenter" title="回到丹佛市中心" onClick={()=>map.flyTo(center,14)}><Navigation size={16}/></button> }
function markerIcon(cafe, active) { return L.divIcon({ className:'custom-marker-wrap', html:`<div class="custom-marker ${active?'active':''}" style="--marker:${cafe.color}"><span>${cafe.rating}</span></div>`, iconSize:[active?48:39,active?48:39], iconAnchor:[active?24:19,active?46:37], popupAnchor:[0,-38] }) }
function Map({ visibleCafes, selected, onSelect }) {
  const center=[39.7486,-104.992]
  return <div className="map-wrap real-map"><MapContainer center={center} zoom={14} zoomControl={false} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><ZoomControl position="topright"/><Recenter center={center}/>{visibleCafes.map(cafe=><Marker key={cafe.id} position={cafe.position} icon={markerIcon(cafe, selected===cafe.id)} eventHandlers={{click:()=>onSelect(cafe.id)}}><Popup><strong>{cafe.name}</strong><br/><span>★ {cafe.rating} · {cafe.distance} km</span></Popup></Marker>)}</MapContainer><div className="map-caption"><MapPin size={15}/> Denver, Colorado <span>·</span> {visibleCafes.length} places nearby</div></div>
}

function App() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('全部')
  const [sort, setSort] = useState('推荐排序')
  const [selected, setSelected] = useState('1')
  const [favorites, setFavorites] = useState([])
  const filters = ['全部','营业中','4.5+ 评分','手冲咖啡','奶咖']
  const visible = useMemo(() => { let list = cafes.filter(c => (!query || `${c.name}${c.address}${c.category}`.toLowerCase().includes(query.toLowerCase())) && (filter==='全部' || (filter==='营业中' ? c.open : filter==='4.5+ 评分' ? c.rating>=4.5 : c.category===filter))); return [...list].sort((a,b)=>sort==='距离优先'?a.distance-b.distance:sort==='评分优先'?b.rating-a.rating:0) }, [query,filter,sort])
  const toggleFavorite = id => setFavorites(f => f.includes(id) ? f.filter(x=>x!==id) : [...f,id])
  return <main>
    <header className="header"><a className="brand"><span className="brand-mark">R</span><span>ROAST <i>&</i> ROAM</span></a><nav><a className="active">探索门店</a><a>我的收藏 <sup>{favorites.length || ''}</sup></a></nav><button className="location"><Navigation size={15}/> 丹佛市中心 <ChevronDown size={14}/></button><button className="mobile-filter"><SlidersHorizontal size={18}/></button></header>
    <section className="hero"><div><p className="eyebrow">YOUR DAILY CUP, DISCOVERED</p><h1>附近的<br/><em>咖啡店</em></h1></div><div className="hero-note"><span className="vertical-line"/><p>从第一口开始，<br/>认识这座城市。</p></div></section>
    <section className="workspace"><div className="list-panel"><div className="search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索店名、街区或风味..."/>{query&&<button onClick={()=>setQuery('')}><X size={16}/></button>}</div><div className="toolbar"><div className="filter-scroll">{filters.map(f=><button key={f} className={filter===f?'chosen':''} onClick={()=>setFilter(f)}>{f}</button>)}</div><button className="sort" onClick={()=>setSort(sort==='推荐排序'?'距离优先':sort==='距离优先'?'评分优先':'推荐排序')}><ArrowUpDown size={14}/>{sort}</button></div><div className="result-head"><p><strong>{visible.length}</strong> 家值得探索</p><span>更新于刚刚</span></div><div className="cards">{visible.length ? visible.map(c=><CafeCard key={c.id} cafe={c} selected={selected===c.id} favorite={favorites.includes(c.id)} onSelect={setSelected} onFavorite={toggleFavorite}/>) : <div className="empty"><Coffee size={25}/><h3>没有找到这杯咖啡</h3><p>试试换个关键词或筛选条件。</p></div>}</div></div><Map visibleCafes={visible} selected={selected} onSelect={setSelected}/></section>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
