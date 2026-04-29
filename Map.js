import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function Map({ height = 280 }) {
  return (
    <View style={[styles.container, { height }]}>
      <Text style={styles.text}>📍 지도는 웹에서만 보여요</Text>
      <Text style={styles.subText}>
        모바일에서는 react-native-webview로 감싸야 합니다.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  text: { fontSize: 14, fontWeight: '700', color: '#666' },
  subText: { fontSize: 11, color: '#888', marginTop: 6 },
});
