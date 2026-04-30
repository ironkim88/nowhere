import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const blueIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const meIcon = new L.DivIcon({
  className: 'me-marker',
  html: '<div style="background:#3182F6;border:3px solid #FFF;width:18px;height:18px;border-radius:9px;box-shadow:0 0 0 4px rgba(49,130,246,0.25)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const makeColoredIcon = (bg, label) => new L.DivIcon({
  className: 'colored-marker',
  html: `<div style="background:${bg};border:2px solid #FFF;width:22px;height:22px;border-radius:11px;box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:11px;color:#FFF;font-weight:800">${label}</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const enrouteIcon = makeColoredIcon('#22C55E', '🚶');
const arrivedIcon = makeColoredIcon('#F59E0B', '✓');

function ClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      if (onPick) onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function Recenter({ center }) {
  const map = useMap();
  const lastRef = useRef(null);
  useEffect(() => {
    if (!center) return;
    const key = `${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
    if (lastRef.current === key) return;
    lastRef.current = key;
    map.setView([center.lat, center.lng], map.getZoom());
  }, [center, map]);
  return null;
}

export default function Map({
  center,
  markers = [],
  enroute = [],
  arrivals = [],
  selected,
  height = 280,
  zoom = 14,
  onMarkerPress,
  onPick,
  showRadius,
  radiusKm = 10,
  userLocation,
}) {
  const c = center || { lat: 37.5251, lng: 126.9249 };
  return (
    <div style={{ height, width: '100%', borderRadius: 16, overflow: 'hidden' }}>
      <MapContainer
        center={[c.lat, c.lng]}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Recenter center={c} />
        {onPick && <ClickHandler onPick={onPick} />}

        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={meIcon}>
            <Popup>📍 내 위치</Popup>
          </Marker>
        )}
        {showRadius && userLocation && (
          <Circle
            center={[userLocation.lat, userLocation.lng]}
            radius={radiusKm * 1000}
            pathOptions={{
              color: '#3182F6',
              fillColor: '#3182F6',
              fillOpacity: 0.12,
              weight: 2,
              dashArray: '6 6',
            }}
          />
        )}

        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={blueIcon}
            eventHandlers={{
              click: () => onMarkerPress && onMarkerPress(m),
            }}
          >
            <Popup>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{m.title}</div>
              <div style={{ fontSize: 11, color: '#666' }}>{m.location}</div>
            </Popup>
          </Marker>
        ))}

        {selected && (
          <Marker position={[selected.lat, selected.lng]} icon={blueIcon}>
            <Popup autoPan>선택한 위치</Popup>
          </Marker>
        )}

        {enroute.map((e, i) => (
          <Marker key={`er-${e.user}-${i}`} position={[e.lat, e.lng]} icon={enrouteIcon}>
            <Popup>
              <div style={{ fontSize: 12, fontWeight: 700 }}>🚶 {e.user}</div>
              <div style={{ fontSize: 11, color: '#666' }}>가는 중</div>
            </Popup>
          </Marker>
        ))}

        {arrivals.map((a, i) =>
          a.lat != null && a.lng != null ? (
            <Marker key={`ar-${a.user}-${i}`} position={[a.lat, a.lng]} icon={arrivedIcon}>
              <Popup>
                <div style={{ fontSize: 12, fontWeight: 700 }}>✓ {a.user}</div>
                <div style={{ fontSize: 11, color: '#666' }}>도착 완료</div>
              </Popup>
            </Marker>
          ) : null,
        )}
      </MapContainer>
    </div>
  );
}
