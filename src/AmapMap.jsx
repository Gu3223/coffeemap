import React, { useEffect, useRef, useState } from 'react'
import { LocateFixed, MapPin, X } from 'lucide-react'
import { clusterPlaces } from '../shared/mapClusters.js'
import { formatDistance } from '../shared/placePresentation.js'
import { loadAmap } from './amapClient.js'

function markerContent(place, active) {
  const value = place.rating == null ? '•' : place.rating.toFixed(1)
  return `<button class="amap-place-marker${active ? ' active' : ''}" aria-label="查看门店"><span>${value}</span></button>`
}

function clusterContent(count) {
  return `<button class="amap-cluster-marker" aria-label="这附近 ${count} 家"><strong>${count}</strong><span>家</span></button>`
}

export default function AmapMap({ places, selected, onSelect, location, onLocate, onManualLocation }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const AMapRef = useRef(null)
  const overlaysRef = useRef([])
  const locationOverlaysRef = useRef([])
  const manualMarkerRef = useRef(null)
  const [zoom, setZoom] = useState(14)
  const [status, setStatus] = useState('loading')
  const [candidate, setCandidate] = useState(null)

  useEffect(() => {
    let cancelled = false
    let map
    loadAmap().then(AMap => {
      if (cancelled || !containerRef.current) return
      AMapRef.current = AMap
      map = new AMap.Map(containerRef.current, {
        center: [location.longitude, location.latitude],
        zoom: 14,
        viewMode: '2D',
        resizeEnable: true
      })
      mapRef.current = map
      map.on('zoomend', () => setZoom(map.getZoom()))
      map.on('click', event => setCandidate({ longitude: event.lnglat.getLng(), latitude: event.lnglat.getLat() }))
      setStatus('ready')
    }).catch(() => { if (!cancelled) setStatus('error') })
    return () => {
      cancelled = true
      map?.destroy()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !location) return
    map.setCenter([location.longitude, location.latitude], false, 260)
  }, [location?.latitude, location?.longitude])

  useEffect(() => {
    const map = mapRef.current
    const AMap = AMapRef.current
    if (!map || !AMap) return
    map.remove(locationOverlaysRef.current)
    const center = [location.longitude, location.latitude]
    const marker = new AMap.Marker({
      position: center,
      zIndex: 160,
      content: '<div class="amap-user-marker"><span></span></div>',
      offset: new AMap.Pixel(-10, -10)
    })
    const overlays = [marker]
    if (Number.isFinite(location.accuracy)) {
      overlays.push(new AMap.Circle({
        center,
        radius: location.accuracy,
        strokeColor: '#287F68',
        strokeOpacity: 0.45,
        strokeWeight: 1,
        fillColor: '#75B39F',
        fillOpacity: 0.12
      }))
    }
    map.add(overlays)
    locationOverlaysRef.current = overlays
  }, [location])

  useEffect(() => {
    const map = mapRef.current
    const AMap = AMapRef.current
    if (!map || !AMap) return
    map.remove(overlaysRef.current)
    const clusters = clusterPlaces(places, zoom)
    const overlays = clusters.map(cluster => {
      const multiple = cluster.count > 1
      const place = cluster.places.find(item => item.id === selected) || cluster.place
      const position = multiple
        ? [cluster.center[1], cluster.center[0]]
        : [place.position[1], place.position[0]]
      const marker = new AMap.Marker({
        position,
        zIndex: place.id === selected ? 150 : 120,
        content: multiple ? clusterContent(cluster.count) : markerContent(place, place.id === selected),
        offset: new AMap.Pixel(multiple ? -23 : -20, multiple ? -23 : -40)
      })
      marker.on('click', () => {
        if (multiple) map.setZoomAndCenter(Math.min(19, zoom + 2), position)
        else onSelect(place.id)
      })
      return marker
    })
    map.add(overlays)
    overlaysRef.current = overlays
    return () => { if (mapRef.current) mapRef.current.remove(overlays) }
  }, [places, selected, zoom, onSelect])

  useEffect(() => {
    const map = mapRef.current
    const AMap = AMapRef.current
    if (!map || !AMap) return
    if (manualMarkerRef.current) map.remove(manualMarkerRef.current)
    manualMarkerRef.current = null
    if (!candidate) return
    const marker = new AMap.Marker({
      position: [candidate.longitude, candidate.latitude],
      draggable: true,
      zIndex: 200,
      content: '<div class="amap-manual-marker"><span></span></div>',
      offset: new AMap.Pixel(-14, -28)
    })
    marker.on('dragend', event => setCandidate({ longitude: event.lnglat.getLng(), latitude: event.lnglat.getLat() }))
    map.add(marker)
    manualMarkerRef.current = marker
  }, [candidate])

  const confirmCandidate = () => {
    if (!candidate) return
    onManualLocation({
      ...candidate,
      accuracy: null,
      source: 'manual',
      address: '',
      label: '地图选点',
      coordinateSystem: 'gcj02',
      isApproximate: false
    })
    setCandidate(null)
  }

  return <div className="map-wrap real-map amap-shell">
    <div ref={containerRef} className="amap-map"/>
    {status === 'loading' && <div className="map-loading">正在载入高德地图…</div>}
    {status === 'error' && <div className="map-loading map-error"><strong>地图暂时未加载</strong><button onClick={onLocate}>重新定位</button></div>}
    <button className="recenter amap-recenter" title="回到当前位置" aria-label="回到当前位置" onClick={() => { mapRef.current?.setZoomAndCenter(14, [location.longitude, location.latitude]); onLocate?.() }}><LocateFixed size={17}/></button>
    {candidate && <div className="manual-location-card"><MapPin size={17}/><div><strong>把这里设为搜索中心？</strong><span>拖动图钉可以继续调整</span></div><button onClick={confirmCandidate}>使用这里</button><button className="icon-button" onClick={() => setCandidate(null)} aria-label="取消选点"><X size={16}/></button></div>}
    <div className="map-caption"><MapPin size={15}/><span>{location.label || '当前位置'}</span><span>{places.length} 家</span><span>{places[0] ? `最近 ${formatDistance(places[0].distanceKm)}` : '点击地图可校准'}</span></div>
  </div>
}
