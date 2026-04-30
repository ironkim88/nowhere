import React, { useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

const buildHtml = ({ center, markers, userLocation, showRadius, radiusKm, zoom, onPick }) => {
  const c = center || { lat: 37.5251, lng: 126.9249 };
  const safeZoom = zoom || 14;
  const markersJson = JSON.stringify(markers || []);
  const userLocJson = userLocation ? JSON.stringify(userLocation) : 'null';
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
  body { background: #f0f0f0; }
  .me-marker {
    background: #3182F6;
    border: 3px solid #fff;
    width: 18px; height: 18px; border-radius: 9px;
    box-shadow: 0 0 0 4px rgba(49,130,246,0.25);
  }
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('map').setView([${c.lat}, ${c.lng}], ${safeZoom});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  var markers = ${markersJson};
  var userLoc = ${userLocJson};

  if (userLoc) {
    var meIcon = L.divIcon({
      className: 'me-marker-wrap',
      html: '<div class="me-marker"></div>',
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    L.marker([userLoc.lat, userLoc.lng], { icon: meIcon }).addTo(map).bindPopup('📍 내 위치');
  }

  ${showRadius && userLocation ? `
  L.circle([userLoc.lat, userLoc.lng], {
    radius: ${radiusKm * 1000},
    color: '#3182F6', fillColor: '#3182F6', fillOpacity: 0.12, weight: 2, dashArray: '6,6'
  }).addTo(map);
  ` : ''}

  markers.forEach(function(m) {
    var mk = L.marker([m.lat, m.lng]).addTo(map);
    mk.bindPopup('<b>' + (m.title || '') + '</b><br>' + (m.location || ''));
    mk.on('click', function() {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'marker', id: m.id }));
      }
    });
  });

  ${onPick ? `
  map.on('click', function(e) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pick', lat: e.latlng.lat, lng: e.latlng.lng
      }));
    }
  });
  ` : ''}
</script>
</body></html>`;
};

export default function Map({
  center,
  markers = [],
  userLocation,
  showRadius,
  radiusKm = 10,
  height = 280,
  zoom = 14,
  onMarkerPress,
  onPick,
}) {
  const html = useMemo(
    () => buildHtml({ center, markers, userLocation, showRadius, radiusKm, zoom, onPick: !!onPick }),
    [center, markers, userLocation, showRadius, radiusKm, zoom, onPick],
  );
  const handleMessage = (e) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'marker' && onMarkerPress) {
        const m = (markers || []).find((mk) => mk.id === data.id);
        if (m) onMarkerPress(m);
      } else if (data.type === 'pick' && onPick) {
        onPick({ lat: data.lat, lng: data.lng });
      }
    } catch {}
  };
  return (
    <View style={[styles.container, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        onMessage={handleMessage}
        style={{ flex: 1, backgroundColor: '#f0f0f0' }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
});
