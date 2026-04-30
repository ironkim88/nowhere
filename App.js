import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView, SafeAreaView,
  Image, Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  StatusBar, RefreshControl, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView from './Map';
import {
  ensureAnonymousAuth,
  subscribeToPosts,
  subscribeToProfile,
  upsertPost,
  deletePostFs,
  upsertProfile,
  seedIfEmpty,
  submitReportFs,
  subscribeToReportsAgainst,
  subscribeToIsAdmin,
} from './firebase';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';

const STORAGE = {
  posts: '@nowhere_posts_v1',
  chats: '@nowhere_chats_v1',
  profile: '@nowhere_profile_v1',
  notifications: '@nowhere_notifs_v1',
  onboarded: '@nowhere_onboarded_v1',
};

const CATEGORIES = [
  '🏃‍♂️ 러닝', '☕ 커피/수다', '👨‍👩‍👧‍👦 육아/키즈',
  '🍺 치맥', '🎮 게임', '🎨 취미', '🏞 산책',
];

const CATEGORY_COLORS = {
  '🏃‍♂️ 러닝': { bg: '#F0F4FF', color: '#3182F6' },
  '☕ 커피/수다': { bg: '#FFF8E1', color: '#F59E0B' },
  '👨‍👩‍👧‍👦 육아/키즈': { bg: '#FFF0F0', color: '#FF5C5C' },
  '🍺 치맥': { bg: '#FEF3C7', color: '#D97706' },
  '🎮 게임': { bg: '#EDE9FE', color: '#7C3AED' },
  '🎨 취미': { bg: '#FEF7FF', color: '#C026D3' },
  '🏞 산책': { bg: '#E8F5E9', color: '#4CAF50' },
};

const getCategoryColor = (cat) =>
  CATEGORY_COLORS[cat] || { bg: '#F0F0F0', color: '#666' };

const DAILY_PEOPLE_LIMIT = 3;
const DAILY_MESSAGES_LIMIT = 15;

const NEARBY_RADIUS_KM = 5;
const MAX_CONCURRENT_JOINS = 2;
const MIN_JOIN_GAP_MIN = 30;
const DEFAULT_LOCATION = { lat: 37.5251, lng: 126.9249 };

const distanceKm = (a, b) => {
  if (!a || !b) return null;
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const formatDistance = (km) => {
  if (km == null) return '거리 정보 없음';
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ensureUsageToday = (usage) => {
  const t = todayStr();
  if (!usage || usage.date !== t) {
    return { date: t, chatPeople: [], messages: {} };
  }
  return usage;
};

const CAPACITY_OPTIONS = [
  { value: 5, label: '1~5명' },
  { value: 10, label: '5~10명' },
  { value: null, label: '10명 이상' },
];

const DAILY_POST_LIMIT = 3;
const MAX_MEETUP_AHEAD_HOURS = 3;

const parseHHMM = (str) => {
  if (!str) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min) || h > 23 || min > 59) return null;
  return { h, min };
};

const computeMeetupMs = (timeStr, deadlineMs) => {
  const parsed = parseHHMM(timeStr);
  if (!parsed) return null;
  const d = new Date();
  d.setHours(parsed.h, parsed.min, 0, 0);
  if (d.getTime() < deadlineMs) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
};

const isSameDay = (a, b) => {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

const WHEEL_ITEM_HEIGHT = 44;
const WHEEL_VISIBLE_ITEMS = 5;

function WheelPicker({ items, value, onChange }) {
  const scrollRef = useRef(null);
  const debounceRef = useRef(null);
  const initRef = useRef(false);
  const idx = Math.max(0, items.indexOf(value));

  useEffect(() => {
    if (initRef.current || !scrollRef.current) return;
    initRef.current = true;
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: idx * WHEEL_ITEM_HEIGHT,
        animated: false,
      });
    }, 50);
  }, [idx]);

  const onScroll = (e) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const y = e.nativeEvent.contentOffset.y;
    debounceRef.current = setTimeout(() => {
      const newIdx = Math.round(y / WHEEL_ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(items.length - 1, newIdx));
      if (items[clamped] !== value) onChange(items[clamped]);
    }, 120);
  };

  return (
    <View style={{ position: 'relative', width: 80, height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ITEMS }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE_ITEMS / 2),
          left: 0,
          right: 0,
          height: WHEEL_ITEM_HEIGHT,
          backgroundColor: '#F0F4FF',
          borderRadius: 8,
          zIndex: 0,
        }}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingVertical: WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE_ITEMS / 2),
        }}
        style={{ flex: 1, zIndex: 1 }}
      >
        {items.map((item, i) => (
          <View
            key={item}
            style={{
              height: WHEEL_ITEM_HEIGHT,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                fontSize: i === idx ? 22 : 16,
                color: i === idx ? '#3182F6' : '#AAA',
                fontWeight: i === idx ? '900' : '500',
              }}
            >
              {String(item).padStart(2, '0')}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const formatTimeHHMM = (ms) => {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

const formatCapacity = (cap) => {
  if (cap == null) return '10명 이상';
  if (cap === 5) return '1~5명';
  if (cap === 10) return '5~10명';
  return `${cap}명`;
};

const formatTimeLeft = (deadline, now) => {
  const diff = deadline - now;
  if (diff <= 0) return { text: '마감됨', urgent: false, expired: true };
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return { text: '곧 마감', urgent: true, expired: false };
  if (mins < 60) return { text: `마감 ${mins}분 전`, urgent: mins <= 15, expired: false };
  const hrs = Math.floor(mins / 60);
  return { text: `마감 ${hrs}시간 ${mins % 60}분 전`, urgent: false, expired: false };
};

const seedPosts = () => {
  const now = Date.now();
  return [
    {
      id: 'seed-1',
      category: '🏃‍♂️ 러닝',
      title: '여의도 한강공원 가볍게 뛰실 분!',
      gender: '누구나',
      ages: ['20대', '30대'],
      location: '여의나루역 2번 출구',
      deadlineMs: now + 12 * 60 * 1000,
      author: '러너H',
      participants: ['러너H', '천천히뛰는중'],
      cancelled: [],
      reviews: [],
      capacity: 5,
      meetupMs: now + (12 + 15) * 60 * 1000,
      lat: 37.5275,
      lng: 126.9322,
      description: '한강공원 따라 30분 정도 가볍게 조깅해요. 페이스 6분 30초 ~ 7분 예상.',
      comments: [
        { id: 'c1', user: '러너H', text: '5분 뒤 도착합니다!', ts: now - 60000 },
        { id: 'c2', user: '천천히뛰는중', text: '저도 가요~', ts: now - 30000 },
      ],
    },
    {
      id: 'seed-2',
      category: '👨‍👩‍👧‍👦 육아/키즈',
      title: '아이들 데리고 공원 비눗방울 놀이 하실 분!',
      gender: '누구나',
      ages: ['30대'],
      location: '동네 근린공원 분수대',
      deadlineMs: now + 30 * 60 * 1000,
      author: '육아맘A',
      participants: ['육아맘A'],
      cancelled: [],
      reviews: [],
      capacity: 10,
      meetupMs: now + (30 + 30) * 60 * 1000,
      lat: 37.5230,
      lng: 126.9180,
      description: '4-7세 아이들과 함께 비눗방울 놀이해요. 비눗방울 도구는 제가 가져갑니다!',
      comments: [
        { id: 'c3', user: '육아맘A', text: '비눗방울 챙겨갑니다!', ts: now - 100000 },
      ],
    },
    {
      id: 'seed-3',
      category: '☕ 커피/수다',
      title: '점심시간 짧게 커피 한잔',
      gender: '누구나',
      ages: ['연령무관'],
      location: 'IFC몰 1층 블루보틀',
      deadlineMs: now - 30 * 60 * 1000,
      author: '커피러버',
      participants: ['커피러버', '동네육아대디', '여의도직장인'],
      cancelled: [],
      reviews: [],
      capacity: 5,
      meetupMs: now - (30 - 15) * 60 * 1000,
      lat: 37.5253,
      lng: 126.9259,
      description: '12시 정각에 만나서 30분간 가볍게 수다 떨어요.',
      comments: [
        { id: 'c4', user: '커피러버', text: '오늘 즐거웠어요!', ts: now - 20 * 60 * 1000 },
      ],
    },
  ];
};

const seedChats = () => {
  const now = Date.now();
  return [
    {
      id: 'chat-1',
      partner: '러너H',
      name: '🏃‍♂️ 러너H',
      avatar: 'https://i.pravatar.cc/100?u=4',
      unread: 1,
      messages: [
        { id: 'm1', sender: 'them', text: '안녕하세요!', ts: now - 600000 },
        { id: 'm2', sender: 'me', text: '네, 안녕하세요!', ts: now - 540000 },
        { id: 'm3', sender: 'them', text: '지금 여의나루역 2번출구 쪽으로 가고 있습니다!', ts: now - 60000 },
      ],
    },
    {
      id: 'chat-2',
      partner: '육아맘A',
      name: '👩 육아맘A',
      avatar: 'https://i.pravatar.cc/100?u=5',
      unread: 0,
      messages: [
        { id: 'm1', sender: 'them', text: '비눗방울 어디서 사셨어요? 저희도 하나 사고 싶어서요.', ts: now - 86400000 },
      ],
    },
  ];
};

const defaultProfile = {
  nickname: '동네육아대디',
  ageGroup: '30대',
  gender: '남성',
  spark: 42.5,
  success: 19,
  noShow: 1,
  friends: ['러너H', '육아맘A'],
  blocked: [],
  chatUsage: { date: todayStr(), chatPeople: [], messages: {} },
};

const hashStr = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const mockUserProfile = (nickname) => {
  const h = hashStr(nickname);
  const ageGroups = ['20대', '30대', '40대'];
  const genders = ['남성', '여성'];
  return {
    nickname,
    ageGroup: ageGroups[h % ageGroups.length],
    gender: genders[(h >> 3) % genders.length],
    spark: 30 + (h % 60),
    success: h % 50,
    noShow: (h >> 5) % 4,
    avatar: `https://i.pravatar.cc/100?u=${encodeURIComponent(nickname)}`,
  };
};

export default function App() {
  const [tab, setTab] = useState('홈');
  const [posts, setPosts] = useState([]);
  const [chats, setChats] = useState(seedChats);
  const [profile, setProfile] = useState(defaultProfile);
  const [uid, setUid] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [filterCategory, setFilterCategory] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewRadiusKm, setViewRadiusKm] = useState(5);
  const [sortMode, setSortMode] = useState('deadline');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [userLocation, setUserLocation] = useState(DEFAULT_LOCATION);
  const [locationStatus, setLocationStatus] = useState('default');
  const [darkMode, setDarkMode] = useState(false);
  const [pickedLocation, setPickedLocation] = useState(null);
  const [pickedImage, setPickedImage] = useState(null);
  const [reportsAgainstMe, setReportsAgainstMe] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const [modal, setModal] = useState({
    profile: false, write: false, detail: false,
    report: false, chat: false, editProfile: false, userProfile: false,
    notifications: false, onboarding: false, mapView: false, pickLocation: false,
    admin: false,
  });
  const open = (k) => setModal((m) => ({ ...m, [k]: true }));
  const close = (k) => setModal((m) => ({ ...m, [k]: false }));

  const [activePost, setActivePost] = useState(null);
  const [activeChat, setActiveChat] = useState(null);

  const initialForm = {
    category: '☕ 커피/수다',
    gender: '누구나',
    ages: ['연령무관'],
    limitTime: 60,
    meetupTime: '',
    capacity: 5,
    title: '',
    location: '',
    description: '',
  };
  const [form, setForm] = useState(initialForm);
  const updateForm = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const [commentInput, setCommentInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [editNickname, setEditNickname] = useState('');

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      setLocationStatus('requesting');
      try {
        if (Platform.OS === 'web') {
          if (typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setLocationStatus('granted');
              },
              () => setLocationStatus('denied'),
              { timeout: 7000, maximumAge: 60000 },
            );
          } else {
            setLocationStatus('denied');
          }
        } else {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            setLocationStatus('denied');
            return;
          }
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocationStatus('granted');
        }
      } catch (e) {
        console.warn('location failed', e);
        setLocationStatus('denied');
      }
    })();
  }, []);

  // Anonymous auth
  useEffect(() => {
    (async () => {
      try {
        const user = await ensureAnonymousAuth();
        setUid(user.uid);
        setAuthReady(true);
        // Seed posts on first run
        await seedIfEmpty(seedPosts());
      } catch (e) {
        console.warn('auth failed', e);
        setAuthReady(true);
      }
    })();
  }, []);

  // Local-only loads (chats, notifications, onboarding)
  useEffect(() => {
    (async () => {
      try {
        const [c, n, ob] = await Promise.all([
          AsyncStorage.getItem(STORAGE.chats),
          AsyncStorage.getItem(STORAGE.notifications),
          AsyncStorage.getItem(STORAGE.onboarded),
        ]);
        if (c) setChats(JSON.parse(c));
        if (n) setNotifications(JSON.parse(n));
        if (!ob) {
          setModal((m) => ({ ...m, onboarding: true }));
        }
      } catch (e) { console.warn('local load failed', e); }
    })();
  }, []);

  // Subscribe to posts (Firestore)
  useEffect(() => {
    if (!authReady) return;
    const unsub = subscribeToPosts((posts) => setPosts(posts));
    return () => unsub();
  }, [authReady]);

  // Subscribe to reports against me
  useEffect(() => {
    if (!authReady || !profile.nickname) return;
    const unsub = subscribeToReportsAgainst(profile.nickname, setReportsAgainstMe);
    return () => unsub();
  }, [authReady, profile.nickname]);

  // Subscribe to admin role
  useEffect(() => {
    if (!authReady || !uid) return;
    const unsub = subscribeToIsAdmin(uid, setIsAdmin);
    return () => unsub();
  }, [authReady, uid]);

  // Subscribe to profile (Firestore) — auto-create on first run
  useEffect(() => {
    if (!authReady || !uid) return;
    const unsub = subscribeToProfile(uid, (remoteProfile) => {
      if (remoteProfile) {
        setProfile(remoteProfile);
      } else {
        const initial = { ...defaultProfile, uid };
        upsertProfile(initial);
        setProfile(initial);
      }
    });
    return () => unsub();
  }, [authReady, uid]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE.chats, JSON.stringify(chats)).catch(() => {});
  }, [chats]);
  useEffect(() => {
    AsyncStorage.setItem(STORAGE.notifications, JSON.stringify(notifications)).catch(() => {});
  }, [notifications]);

  const toggleAge = (age) => {
    if (age === '연령무관') {
      updateForm('ages', ['연령무관']);
      return;
    }
    let next = form.ages.filter((a) => a !== '연령무관');
    next = next.includes(age) ? next.filter((a) => a !== age) : [...next, age];
    updateForm('ages', next.length === 0 ? ['연령무관'] : next);
  };

  const handleAddPost = () => {
    if (isSuspended) {
      Alert.alert(
        '계정 정지 중',
        `신고 누적으로 24시간 정지 중이에요.\n해제: ${new Date(suspensionEndsAt).toLocaleString('ko-KR')}`,
      );
      return;
    }
    if (!form.title.trim() || !form.location.trim()) {
      Alert.alert('알림', '제목과 장소를 모두 입력해주세요.');
      return;
    }
    const todayCount = posts.filter(
      (p) =>
        p.author === profile.nickname &&
        p.createdAt &&
        isSameDay(p.createdAt, Date.now()),
    ).length;
    if (todayCount >= DAILY_POST_LIMIT) {
      Alert.alert(
        '일일 한도 도달',
        `하루에 최대 ${DAILY_POST_LIMIT}개의 모임만 만들 수 있어요.\n내일 다시 이용해주세요.`,
      );
      return;
    }
    const coords = pickedLocation || userLocation;
    const deadlineMs = Date.now() + form.limitTime * 60 * 1000;
    let meetupMs;
    if (form.meetupTime.trim()) {
      meetupMs = computeMeetupMs(form.meetupTime, deadlineMs);
      if (!meetupMs) {
        Alert.alert(
          '만나는 시간 오류',
          '만나는 시간을 HH:MM (24시간 형식)으로 입력해주세요.\n예) 19:00, 21:30',
        );
        return;
      }
    } else {
      meetupMs = deadlineMs + 15 * 60 * 1000;
    }
    if (meetupMs > Date.now() + MAX_MEETUP_AHEAD_HOURS * 60 * 60 * 1000) {
      Alert.alert(
        '시간 제한',
        `만나는 시간은 지금으로부터 ${MAX_MEETUP_AHEAD_HOURS}시간 이내여야 해요.\n"지금, 여기"는 짧고 가벼운 만남을 위한 앱이에요.`,
      );
      return;
    }
    const newPost = {
      id: `p-${Date.now()}`,
      createdAt: Date.now(),
      category: form.category,
      title: form.title.trim(),
      gender: form.gender,
      ages: form.ages,
      location: form.location.trim(),
      description: form.description.trim(),
      deadlineMs,
      meetupMs,
      capacity: form.capacity,
      lat: coords.lat,
      lng: coords.lng,
      image: pickedImage,
      author: profile.nickname,
      participants: [profile.nickname],
      cancelled: [],
      reviews: [],
      comments: [],
    };
    upsertPost(newPost).catch((e) => Alert.alert('저장 실패', String(e?.message || e)));
    setForm(initialForm);
    setPickedLocation(null);
    setPickedImage(null);
    close('write');
    setTab('홈');
  };

  const handleDeletePost = (id) => {
    Alert.alert('삭제', '이 모임을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          deletePostFs(id).catch(() => {});
          close('detail');
          setActivePost(null);
        },
      },
    ]);
  };

  const openDetail = (post) => {
    setActivePost(post);
    open('detail');
  };

  const updateActivePost = (updated) => {
    upsertPost(updated).catch(() => {});
    setActivePost(updated);
  };

  const updateProfile = (next) => {
    setProfile(next);
    if (next.uid) upsertProfile(next).catch(() => {});
  };

  const recentReports = reportsAgainstMe.filter(
    (r) => r.ts > Date.now() - 24 * 60 * 60 * 1000,
  );
  const isSuspended = recentReports.length >= 3;
  const suspensionEndsAt = isSuspended
    ? Math.max(...recentReports.map((r) => r.ts)) + 24 * 60 * 60 * 1000
    : null;

  const handleJoin = () => {
    if (!activePost) return;
    const cancelled = activePost.cancelled || [];
    const participants = activePost.participants || [];
    const cap = activePost.capacity;
    if (cancelled.includes(profile.nickname)) {
      Alert.alert('참여 불가', '한 번 취소한 모임에는 다시 신청할 수 없어요.');
      return;
    }
    if (participants.includes(profile.nickname)) return;
    if (cap != null && participants.length >= cap) {
      Alert.alert('정원 마감', `이 모임은 ${cap}명 정원이 모두 찼어요.`);
      return;
    }
    if (activePost.lat != null && activePost.lng != null) {
      const d = distanceKm(userLocation, { lat: activePost.lat, lng: activePost.lng });
      if (d != null && d > NEARBY_RADIUS_KM) {
        Alert.alert(
          '너무 멀어요',
          `이 모임은 ${formatDistance(d)} 떨어져 있어요.\n${NEARBY_RADIUS_KM}km 반경 안에서만 참여할 수 있어요.`,
        );
        return;
      }
    }

    const myActive = posts.filter(
      (p) =>
        p.id !== activePost.id &&
        p.deadlineMs > now &&
        (p.participants || []).includes(profile.nickname) &&
        !(p.cancelled || []).includes(profile.nickname),
    );
    if (myActive.length >= MAX_CONCURRENT_JOINS) {
      Alert.alert(
        '참여 한도 초과',
        `한 번에 최대 ${MAX_CONCURRENT_JOINS}개 모임까지만 참여할 수 있어요.\n진행 중인 모임이 끝난 후 다시 신청해주세요.`,
      );
      return;
    }
    const activeMeetup = activePost.meetupMs || activePost.deadlineMs;
    const tooClose = myActive.find((p) => {
      const pMeetup = p.meetupMs || p.deadlineMs;
      return Math.abs(pMeetup - activeMeetup) < MIN_JOIN_GAP_MIN * 60 * 1000;
    });
    if (tooClose) {
      const tooCloseMeetup = tooClose.meetupMs || tooClose.deadlineMs;
      const diffMin = Math.round(Math.abs(tooCloseMeetup - activeMeetup) / 60000);
      Alert.alert(
        '시간대가 겹쳐요',
        `이미 참여 중인 '${tooClose.title}' (집결 ${formatTimeHHMM(tooCloseMeetup)})와 ${diffMin}분 차이밖에 안 나요.\n만남 시간이 ${MIN_JOIN_GAP_MIN}분 이상 차이나야 해요.`,
      );
      return;
    }

    const enroute = activePost.enroute || [];
    updateActivePost({
      ...activePost,
      participants: [...participants, profile.nickname],
      enroute: [
        ...enroute.filter((e) => e.user !== profile.nickname),
        {
          user: profile.nickname,
          lat: userLocation.lat,
          lng: userLocation.lng,
          ts: Date.now(),
        },
      ],
    });
  };

  const handleCloseEarly = () => {
    if (!activePost) return;
    Alert.alert(
      '모임 종료',
      '지금 즉시 모임을 종료할까요?\n종료 후엔 후기 작성이 가능해져요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '종료',
          onPress: () => {
            updateActivePost({ ...activePost, deadlineMs: Date.now() - 1000 });
            Alert.alert('모임 종료됨', '이제 후기를 작성할 수 있어요.');
          },
        },
      ],
    );
  };

  const handleEnRoute = async () => {
    if (!activePost) return;
    const apply = (lat, lng) => {
      const enroute = activePost.enroute || [];
      const updated = {
        ...activePost,
        enroute: [
          ...enroute.filter((e) => e.user !== profile.nickname),
          { user: profile.nickname, lat, lng, ts: Date.now() },
        ],
      };
      updateActivePost(updated);
      Alert.alert('가는 중 인증', '현재 위치가 지도에 표시됐습니다.');
    };
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => apply(pos.coords.latitude, pos.coords.longitude),
            () => apply(userLocation.lat, userLocation.lng),
            { timeout: 7000, maximumAge: 30000 },
          );
        } else {
          apply(userLocation.lat, userLocation.lng);
        }
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          apply(userLocation.lat, userLocation.lng);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        apply(pos.coords.latitude, pos.coords.longitude);
      }
    } catch (e) {
      apply(userLocation.lat, userLocation.lng);
    }
  };

  const handleArrivalProof = async () => {
    if (!activePost) return;
    const apply = (uri) => {
      const arrivals = activePost.arrivals || [];
      const updated = {
        ...activePost,
        arrivals: [
          ...arrivals.filter((a) => a.user !== profile.nickname),
          { user: profile.nickname, photo: uri, ts: Date.now() },
        ],
      };
      updateActivePost(updated);
      Alert.alert('도착 인증 완료', '인증 사진이 등록되었습니다.');
    };
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) {
          Alert.alert('파일이 큽니다', '3MB 이하 사진만 가능해요.');
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => apply(ev.target.result);
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 필요', '카메라 권한이 필요해요.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const uri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
      apply(uri);
    } catch (e) {
      Alert.alert('오류', '카메라를 열 수 없어요.');
    }
  };

  const handlePickImage = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          Alert.alert('파일이 큽니다', '2MB 이하 이미지만 가능해요.');
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => setPickedImage(ev.target.result);
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요해요.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const uri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
      setPickedImage(uri);
    } catch (e) {
      Alert.alert('오류', '이미지를 가져올 수 없어요.');
    }
  };

  const handleShare = async () => {
    if (!activePost) return;
    const text = `📍 ${activePost.title}\n· ${activePost.location}\n· ${formatTimeLeft(activePost.deadlineMs, now).text}\n\n[지금, 여기]에서 함께해요!`;
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('공유 링크 복사됨', '클립보드에 복사되었어요. 친구에게 붙여넣기 해주세요!');
    } catch (e) {
      Alert.alert('공유', text);
    }
  };

  const REPORT_REASONS = [
    { id: 'noshow', label: '🚫 노쇼 (나타나지 않음)' },
    { id: 'rude', label: '😡 폭언 / 무례한 행동' },
    { id: 'inappropriate', label: '⚠️ 부적절한 행동' },
    { id: 'scam', label: '💸 사기 / 금전 요구' },
    { id: 'spam', label: '📢 스팸 / 광고' },
    { id: 'etc', label: '🗒 기타' },
  ];
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState(null);

  const openReport = () => {
    setReportTarget(null);
    setReportReason(null);
    open('report');
  };

  const submitReport = async () => {
    if (!reportTarget) {
      Alert.alert('알림', '신고할 유저를 선택해주세요.');
      return;
    }
    if (!reportReason) {
      Alert.alert('알림', '신고 사유를 선택해주세요.');
      return;
    }
    const reasonLabel = REPORT_REASONS.find((r) => r.id === reportReason)?.label || '';
    try {
      await submitReportFs({
        from: profile.nickname,
        target: reportTarget,
        reason: reportReason,
        reasonLabel,
        postId: activePost?.id || null,
      });
      Alert.alert(
        '신고 완료',
        `${reportTarget}님을 [${reasonLabel}] 사유로 신고했어요.\n24시간 내 신고 3회 누적 시 자동 정지됩니다.`,
      );
    } catch (e) {
      Alert.alert('신고 실패', '잠시 후 다시 시도해주세요.');
    }
    close('report');
    setReportTarget(null);
    setReportReason(null);
  };

  const handleReview = (target, rating) => {
    if (!activePost) return;
    const reviews = activePost.reviews || [];
    const existing = reviews.find(
      (r) => r.from === profile.nickname && r.target === target,
    );
    let next;
    if (existing && existing.rating === rating) {
      next = reviews.filter((r) => !(r.from === profile.nickname && r.target === target));
    } else if (existing) {
      next = reviews.map((r) =>
        r.from === profile.nickname && r.target === target
          ? { ...r, rating, ts: Date.now() }
          : r,
      );
    } else {
      next = [
        ...reviews,
        { from: profile.nickname, target, rating, ts: Date.now() },
      ];
    }
    updateActivePost({ ...activePost, reviews: next });
  };

  const handleCancelJoin = () => {
    if (!activePost) return;
    Alert.alert(
      '참여 취소',
      '취소하면 이 모임에 다시 신청할 수 없어요. 정말 취소할까요?',
      [
        { text: '돌아가기', style: 'cancel' },
        {
          text: '취소하기',
          style: 'destructive',
          onPress: () => {
            updateActivePost({
              ...activePost,
              participants: (activePost.participants || []).filter(
                (n) => n !== profile.nickname,
              ),
              cancelled: [...(activePost.cancelled || []), profile.nickname],
            });
          },
        },
      ],
    );
  };

  const [viewingUser, setViewingUser] = useState(null);
  const openUserProfile = (nickname) => {
    if (!nickname || nickname === profile.nickname) return;
    setViewingUser(nickname);
    open('userProfile');
  };

  const isFriend = (nickname) => (profile.friends || []).includes(nickname);
  const isBlocked = (nickname) => (profile.blocked || []).includes(nickname);
  const isFavorite = (nickname) => (profile.favorites || []).includes(nickname);

  const toggleFavorite = (nickname) => {
    const favs = profile.favorites || [];
    updateProfile({
      ...profile,
      favorites: favs.includes(nickname)
        ? favs.filter((n) => n !== nickname)
        : [...favs, nickname],
    });
  };

  const chatUsage = ensureUsageToday(profile.chatUsage);
  const messagesSentTo = (target) => chatUsage.messages[target] || 0;
  const peopleSpokenToday = chatUsage.chatPeople.length;

  const openOrCreateChat = (nickname) => {
    if (!isFriend(nickname)) {
      Alert.alert(
        '친구 추가 필요',
        '서로 친구일 때만 1:1 채팅이 가능해요.\n먼저 친구 추가를 해주세요.',
      );
      return;
    }
    let chat = chats.find((c) => c.partner === nickname);
    if (!chat) {
      chat = {
        id: `chat-${Date.now()}`,
        partner: nickname,
        name: nickname,
        avatar: `https://i.pravatar.cc/100?u=${encodeURIComponent(nickname)}`,
        unread: 0,
        messages: [],
      };
      setChats([chat, ...chats]);
    }
    close('userProfile');
    setActiveChat(chat);
    open('chat');
  };

  const toggleFriend = (nickname) => {
    const friends = profile.friends || [];
    if (friends.includes(nickname)) {
      updateProfile({ ...profile, friends: friends.filter((n) => n !== nickname) });
    } else {
      const blocked = (profile.blocked || []).filter((n) => n !== nickname);
      updateProfile({ ...profile, friends: [...friends, nickname], blocked });
    }
  };

  const toggleBlock = (nickname) => {
    const blocked = profile.blocked || [];
    if (blocked.includes(nickname)) {
      updateProfile({ ...profile, blocked: blocked.filter((n) => n !== nickname) });
    } else {
      Alert.alert(
        '차단',
        `${nickname}님을 차단할까요? 차단 시 친구 목록에서 제거되고, 이 분의 모임이 보이지 않아요.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '차단',
            style: 'destructive',
            onPress: () => {
              const friends = (profile.friends || []).filter((n) => n !== nickname);
              updateProfile({ ...profile, blocked: [...blocked, nickname], friends });
              close('userProfile');
            },
          },
        ],
      );
    }
  };

  const handleCommentReaction = (commentId, type) => {
    if (!activePost) return;
    const updated = {
      ...activePost,
      comments: activePost.comments.map((c) => {
        if (c.id !== commentId) return c;
        const reactions = { ...(c.reactions || {}) };
        if (reactions[profile.nickname] === type) {
          delete reactions[profile.nickname];
        } else {
          reactions[profile.nickname] = type;
        }
        return { ...c, reactions };
      }),
    };
    updateActivePost(updated);
  };

  const [requestAction, setRequestAction] = useState({
    visible: false,
    action: null,
    user: null,
    message: '',
  });

  const handleSendJoinRequest = () => {
    if (!activePost) return;
    const requests = activePost.joinRequests || [];
    const existing = requests.find((r) => r.user === profile.nickname);
    if (existing && existing.status === 'pending') {
      Alert.alert('이미 요청됨', '호스트의 응답을 기다려주세요.');
      return;
    }
    if (existing && existing.status === 'rejected') {
      Alert.alert('이전 요청 거절됨', '한 번 거절된 모임에는 다시 요청할 수 없어요.');
      return;
    }
    updateActivePost({
      ...activePost,
      joinRequests: [
        ...requests.filter((r) => r.user !== profile.nickname),
        { user: profile.nickname, ts: Date.now(), status: 'pending' },
      ],
    });
    Alert.alert(
      '참여 요청 전송',
      '호스트가 검토 후 수락/거절을 알려드릴게요.',
    );
  };

  const openRequestAction = (user, action) => {
    setRequestAction({ visible: true, action, user, message: '' });
  };

  const submitRequestAction = () => {
    const { action, user, message } = requestAction;
    if (!activePost || !user || !action) return;
    const requests = activePost.joinRequests || [];
    const updatedRequests = requests.map((r) =>
      r.user === user
        ? {
            ...r,
            status: action === 'accept' ? 'accepted' : 'rejected',
            hostMessage: message.trim(),
            respondedAt: Date.now(),
          }
        : r,
    );
    let updatedPost = { ...activePost, joinRequests: updatedRequests };
    if (action === 'accept' && !(activePost.participants || []).includes(user)) {
      updatedPost.participants = [...(activePost.participants || []), user];
    }
    updateActivePost(updatedPost);
    setRequestAction({ visible: false, action: null, user: null, message: '' });
    Alert.alert(
      action === 'accept' ? '수락 완료' : '거절 완료',
      `${user}님에게 응답이 전달됐어요.`,
    );
  };

  const handleAddComment = () => {
    if (!commentInput.trim() || !activePost) return;
    if (isSuspended) {
      Alert.alert('정지 중', '신고 누적으로 댓글 작성이 제한됐어요.');
      return;
    }
    const updated = {
      ...activePost,
      comments: [
        ...activePost.comments,
        {
          id: `c-${Date.now()}`,
          user: profile.nickname,
          text: commentInput.trim(),
          ts: Date.now(),
        },
      ],
    };
    upsertPost(updated).catch(() => {});
    setActivePost(updated);
    setCommentInput('');
  };

  const openChat = (chat) => {
    setActiveChat(chat);
    if (chat.unread > 0) {
      setChats(chats.map((c) => (c.id === chat.id ? { ...c, unread: 0 } : c)));
    }
    open('chat');
  };

  const handleSendChat = () => {
    if (!chatInput.trim() || !activeChat) return;
    const target = activeChat.partner;
    if (!isFriend(target)) {
      Alert.alert(
        '친구 추가 필요',
        '서로 친구일 때만 1:1 채팅이 가능해요.',
      );
      return;
    }
    const usage = ensureUsageToday(profile.chatUsage);
    const sentToTarget = usage.messages[target] || 0;
    const isNewPerson = !usage.chatPeople.includes(target);

    if (sentToTarget >= DAILY_MESSAGES_LIMIT) {
      Alert.alert(
        '오늘 대화 한도 도달',
        `이 분과 오늘 ${DAILY_MESSAGES_LIMIT}회를 모두 사용했어요.\n내일 다시 이용해주세요.\n\n💎 광고 시청 / 프리미엄으로 한도를 늘릴 수 있어요.`,
      );
      return;
    }
    if (isNewPerson && usage.chatPeople.length >= DAILY_PEOPLE_LIMIT) {
      Alert.alert(
        '오늘 대화 인원 한도 도달',
        `오늘 ${DAILY_PEOPLE_LIMIT}명과 이미 대화하셨어요.\n\n💎 광고 시청 / 프리미엄으로 한도를 늘릴 수 있어요.`,
      );
      return;
    }

    const newMsg = {
      id: `m-${Date.now()}`,
      sender: 'me',
      text: chatInput.trim(),
      ts: Date.now(),
    };
    const updated = { ...activeChat, messages: [...activeChat.messages, newMsg] };
    setChats(chats.map((c) => (c.id === updated.id ? updated : c)));
    setActiveChat(updated);
    setChatInput('');

    updateProfile({
      ...profile,
      chatUsage: {
        date: usage.date,
        chatPeople: isNewPerson ? [...usage.chatPeople, target] : usage.chatPeople,
        messages: { ...usage.messages, [target]: sentToTarget + 1 },
      },
    });
  };

  const onRefresh = () => {
    setRefreshing(true);
    setNow(Date.now());
    setTimeout(() => setRefreshing(false), 600);
  };

  const postsWithDistance = useMemo(
    () =>
      posts.map((p) => ({
        ...p,
        distance:
          p.lat != null && p.lng != null
            ? distanceKm(userLocation, { lat: p.lat, lng: p.lng })
            : null,
      })),
    [posts, userLocation],
  );

  const visiblePosts = useMemo(() => {
    const blocked = profile.blocked || [];
    const favs = profile.favorites || [];
    let list = postsWithDistance.filter((p) => !blocked.includes(p.author));
    list = list.filter(
      (p) => p.distance == null || p.distance <= viewRadiusKm,
    );
    if (favoritesOnly) list = list.filter((p) => favs.includes(p.author));
    if (filterCategory) list = list.filter((p) => p.category === filterCategory);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.title, p.location, p.description || '', p.category]
          .some((s) => s.toLowerCase().includes(q)),
      );
    }
    const sortFns = {
      deadline: (a, b) => a.deadlineMs - b.deadlineMs,
      distance: (a, b) =>
        (a.distance ?? Number.POSITIVE_INFINITY) -
        (b.distance ?? Number.POSITIVE_INFINITY),
      newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    };
    return [...list].sort(sortFns[sortMode] || sortFns.deadline);
  }, [postsWithDistance, filterCategory, searchQuery, viewRadiusKm, sortMode, favoritesOnly, profile.blocked, profile.favorites]);

  const heroStats = useMemo(() => {
    const open = posts.filter((p) => p.deadlineMs > now);
    const counts = {};
    open.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
    const topEntry = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const soonest = open.length
      ? open.reduce((min, p) => (p.deadlineMs < min.deadlineMs ? p : min))
      : null;
    const soonestMins = soonest
      ? Math.max(0, Math.floor((soonest.deadlineMs - now) / 60000))
      : null;
    return {
      openCount: open.length,
      topCategory: topEntry ? topEntry[0] : null,
      topCategoryCount: topEntry ? topEntry[1] : 0,
      soonestMins,
    };
  }, [posts, now]);

  const totalUnread = chats.reduce((s, c) => s + c.unread, 0);
  const myPosts = posts.filter((p) => p.author === profile.nickname);

  const computedSpark = useMemo(() => {
    let score = 30;
    let success = 0;
    let cancelled = 0;
    let hosted = 0;
    let likes = 0;
    let dislikes = 0;
    posts.forEach((p) => {
      const isHost = p.author === profile.nickname;
      const isPart = (p.participants || []).includes(profile.nickname);
      const wasCancelled = (p.cancelled || []).includes(profile.nickname);
      const ended = p.deadlineMs <= now;
      if (isHost) hosted += 1;
      if (wasCancelled) cancelled += 1;
      if (ended && isPart) success += 1;
      (p.reviews || []).forEach((r) => {
        if (r.target === profile.nickname) {
          if (r.rating === 'like') likes += 1;
          if (r.rating === 'dislike') dislikes += 1;
        }
      });
    });
    score += success * 0.5 + hosted * 0.3 + likes * 0.5 - cancelled * 1.0 - dislikes * 1.5;
    return {
      spark: Math.max(0, Math.min(100, score)),
      success,
      cancelled,
      hosted,
      likes,
      dislikes,
    };
  }, [posts, now, profile.nickname]);

  const sparkLevel = (s) => {
    if (s >= 80) return { name: '🌳 큰나무', color: '#16A34A' };
    if (s >= 60) return { name: '🌿 묘목', color: '#22C55E' };
    if (s >= 40) return { name: '🌱 새싹', color: '#84CC16' };
    if (s >= 20) return { name: '🌰 씨앗', color: '#A16207' };
    return { name: '🪨 휴면', color: '#888' };
  };

  const sendBrowserPush = (title, body) => {
    if (
      Platform.OS === 'web' &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification(title, { body, icon: '/favicon.ico' });
      } catch (e) {}
    }
  };

  useEffect(() => {
    setNotifications((prev) => {
      const existingKeys = new Set(prev.map((n) => n.key));
      const additions = [];

      // Deadline approaching for posts I joined or hosted
      posts.forEach((p) => {
        const involved =
          p.author === profile.nickname ||
          (p.participants || []).includes(profile.nickname);
        if (!involved) return;
        const minsLeft = Math.floor((p.deadlineMs - now) / 60000);
        if (minsLeft > 0 && minsLeft <= 5) {
          const key = `deadline-${p.id}`;
          if (!existingKeys.has(key)) {
            additions.push({
              id: `n-${Date.now()}-${p.id}`,
              key,
              type: 'deadline',
              title: '⏰ 마감 임박',
              body: `'${p.title}' 마감까지 ${minsLeft}분 남았어요.`,
              ts: Date.now(),
              read: false,
              postId: p.id,
            });
            sendBrowserPush('⏰ 마감 임박', `'${p.title}' 마감까지 ${minsLeft}분`);
          }
        }
        // 30 minutes before meetup
        const meetupMs = p.meetupMs || p.deadlineMs;
        const meetupMinsLeft = Math.floor((meetupMs - now) / 60000);
        if (meetupMinsLeft > 25 && meetupMinsLeft <= 30) {
          const key = `pre-meetup-${p.id}`;
          if (!existingKeys.has(key)) {
            additions.push({
              id: `n-${Date.now()}-pm-${p.id}`,
              key,
              type: 'pre-meetup',
              title: '🚀 곧 시작!',
              body: `'${p.title}' 30분 후 만나요. ${p.location}에서!`,
              ts: Date.now(),
              read: false,
              postId: p.id,
            });
            sendBrowserPush('🚀 곧 시작!', `'${p.title}' 30분 후 만나요`);
          }
        }
      });

      // Pending reviews for ended posts I joined
      posts.forEach((p) => {
        if (p.deadlineMs > now) return;
        if (!(p.participants || []).includes(profile.nickname)) return;
        const others = (p.participants || []).filter((n) => n !== profile.nickname);
        if (others.length === 0) return;
        const myReviews = (p.reviews || []).filter((r) => r.from === profile.nickname);
        if (myReviews.length >= others.length) return;
        const key = `review-${p.id}`;
        if (!existingKeys.has(key)) {
          additions.push({
            id: `n-${Date.now()}-r-${p.id}`,
            key,
            type: 'review',
            title: '🌟 후기 작성 가능',
            body: `'${p.title}' 참여자 ${others.length - myReviews.length}명에게 후기를 남겨주세요.`,
            ts: Date.now(),
            read: false,
            postId: p.id,
          });
        }
      });

      return additions.length === 0 ? prev : [...additions, ...prev];
    });
  }, [posts, now, profile.nickname]);

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  const markNotifRead = (id) => {
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };
  const markAllRead = () => {
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
  };
  const clearNotifs = () => setNotifications([]);

  const myJoinedActive = useMemo(
    () =>
      posts.filter(
        (p) =>
          p.deadlineMs > now &&
          (p.participants || []).includes(profile.nickname) &&
          p.author !== profile.nickname,
      ),
    [posts, now, profile.nickname],
  );

  const myRecentHistory = useMemo(() => {
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    return posts
      .filter(
        (p) =>
          p.deadlineMs <= now &&
          p.deadlineMs >= threeDaysAgo &&
          (p.participants || []).includes(profile.nickname),
      )
      .sort((a, b) => b.deadlineMs - a.deadlineMs);
  }, [posts, now, profile.nickname]);

  return (
    <SafeAreaView
      style={[styles.safeArea, darkMode && { backgroundColor: '#0F172A' }]}
    >
      <StatusBar
        barStyle={darkMode ? 'light-content' : 'dark-content'}
        backgroundColor={darkMode ? '#0F172A' : '#FFF'}
      />
      <View
        style={[styles.container, darkMode && { backgroundColor: '#0F172A' }]}
      >
        <View style={[styles.topBar, darkMode && { backgroundColor: '#1E293B' }]}>
          <Text style={styles.logoText}>📍 지금, 여기</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={() => open('notifications')}
            >
              <Text style={styles.bellIcon}>🔔</Text>
              {unreadNotifCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.profileBox} onPress={() => open('profile')}>
              <View style={styles.profileTextContainer}>
                <Text style={styles.profileNickname}>{profile.nickname}</Text>
                <Text style={styles.profileInfo}>
                  {profile.ageGroup} · {profile.gender}
                </Text>
              </View>
              <Image
                source={{ uri: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' }}
                style={styles.profileImg}
              />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={styles.contentScroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {tab === '홈' && (
            <View>
              <View style={styles.hero}>
                <View style={styles.heroGlow1} />
                <View style={styles.heroGlow2} />
                <TouchableOpacity
                  style={styles.heroMapBtn}
                  onPress={() => open('mapView')}
                >
                  <Text style={styles.heroMapBtnText}>🗺 지도로</Text>
                </TouchableOpacity>
                <View style={styles.heroContent}>
                  <View style={styles.heroLocationRow}>
                    <Text style={styles.heroLocationText}>📍 여의도</Text>
                    <Text style={styles.heroLocationSub}>
                      · {viewRadiusKm === 5 ? '내 주변 5km' : '우리 동네 10km'}
                    </Text>
                  </View>
                  <View style={styles.heroNumRow}>
                    <Text style={styles.heroBigNum}>{heroStats.openCount}</Text>
                    <Text style={styles.heroLabel}>
                      개의 모임이{'\n'}지금 열려있어요
                    </Text>
                  </View>
                  <View style={styles.heroDivider} />
                  <View style={styles.heroStatsRow}>
                    <View style={styles.heroStatItem}>
                      <Text style={styles.heroStatLabel}>🔥 가장 활발</Text>
                      <Text style={styles.heroStatValue} numberOfLines={1}>
                        {heroStats.topCategory
                          ? `${heroStats.topCategory} (${heroStats.topCategoryCount})`
                          : '아직 없음'}
                      </Text>
                    </View>
                    <View style={styles.heroStatDivider} />
                    <View style={styles.heroStatItem}>
                      <Text style={styles.heroStatLabel}>⏰ 가장 임박</Text>
                      <Text style={styles.heroStatValue}>
                        {heroStats.soonestMins == null
                          ? '없음'
                          : heroStats.soonestMins < 1
                          ? '곧 마감'
                          : `${heroStats.soonestMins}분 후`}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.searchWrapper}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="제목, 장소, 카테고리 검색"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Text style={styles.searchClear}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterScroll}
              >
                <TouchableOpacity
                  style={[styles.filterChip, !filterCategory && styles.filterChipOn]}
                  onPress={() => setFilterCategory(null)}
                >
                  <Text style={[styles.filterChipText, !filterCategory && styles.filterChipTextOn]}>
                    전체
                  </Text>
                </TouchableOpacity>
                {CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.filterChip, filterCategory === cat && styles.filterChipOn]}
                    onPress={() => setFilterCategory(filterCategory === cat ? null : cat)}
                  >
                    <Text
                      style={[styles.filterChipText, filterCategory === cat && styles.filterChipTextOn]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.radiusToggleRow}>
                <TouchableOpacity
                  style={[
                    styles.radiusToggleBtn,
                    viewRadiusKm === 5 && styles.radiusToggleBtnOn,
                  ]}
                  onPress={() => setViewRadiusKm(5)}
                >
                  <Text
                    style={[
                      styles.radiusToggleText,
                      viewRadiusKm === 5 && styles.radiusToggleTextOn,
                    ]}
                  >
                    📍 내 주변 (5km)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.radiusToggleBtn,
                    viewRadiusKm === 10 && styles.radiusToggleBtnOn,
                  ]}
                  onPress={() => setViewRadiusKm(10)}
                >
                  <Text
                    style={[
                      styles.radiusToggleText,
                      viewRadiusKm === 10 && styles.radiusToggleTextOn,
                    ]}
                  >
                    🏘 우리 동네 (10km)
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sortScroll}
              >
                {[
                  { id: 'deadline', label: '⏰ 임박순' },
                  { id: 'distance', label: '📍 가까운 순' },
                  { id: 'newest', label: '🆕 새 모임' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.sortChip,
                      sortMode === opt.id && styles.sortChipOn,
                    ]}
                    onPress={() => setSortMode(opt.id)}
                  >
                    <Text
                      style={[
                        styles.sortChipText,
                        sortMode === opt.id && styles.sortChipTextOn,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[
                    styles.sortChip,
                    favoritesOnly && styles.sortChipFavOn,
                  ]}
                  onPress={() => setFavoritesOnly(!favoritesOnly)}
                >
                  <Text
                    style={[
                      styles.sortChipText,
                      favoritesOnly && { color: '#FFF', fontWeight: '800' },
                    ]}
                  >
                    {favoritesOnly ? '⭐ 즐겨찾기 ON' : '☆ 즐겨찾기'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              <View style={styles.header}>
                <Text style={styles.headerTitle}>
                  {viewRadiusKm === 5 ? '내 주변 모임 🏃' : '우리 동네 모임 🏘'}
                </Text>
                <Text style={styles.headerSub}>{visiblePosts.length}개</Text>
              </View>
              {viewRadiusKm === 10 && (
                <Text style={styles.viewRadiusHint}>
                  💡 5km 밖 모임은 회색으로 표시 — 참여는 5km 이내만 가능해요
                </Text>
              )}

              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                {visiblePosts.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyEmoji}>🌱</Text>
                    <Text style={styles.emptyTitle}>아직 열린 모임이 없어요</Text>
                    <Text style={styles.emptyDesc}>가장 먼저 새로운 모임을 열어보세요!</Text>
                    <TouchableOpacity style={styles.emptyBtn} onPress={() => open('write')}>
                      <Text style={styles.emptyBtnText}>모임 만들기</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  visiblePosts.map((post) => {
                    const colors = getCategoryColor(post.category);
                    const t = formatTimeLeft(post.deadlineMs, now);
                    const tooFar = post.distance != null && post.distance > NEARBY_RADIUS_KM;
                    return (
                      <TouchableOpacity
                        key={post.id}
                        style={[
                          styles.card,
                          t.expired && styles.cardExpired,
                          tooFar && styles.cardTooFar,
                        ]}
                        onPress={() => openDetail(post)}
                        activeOpacity={0.85}
                      >
                        {post.image ? (
                          <Image
                            source={{ uri: post.image }}
                            style={styles.cardImage}
                          />
                        ) : null}
                        <View style={styles.cardTopRow}>
                          <View style={[styles.tagContainer, { backgroundColor: colors.bg }]}>
                            <Text style={[styles.tagText, { color: colors.color }]}>
                              {post.category}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.timeAlert,
                              t.urgent && styles.timeAlertUrgent,
                              t.expired && styles.timeAlertExpired,
                            ]}
                          >
                            {t.text}
                          </Text>
                        </View>
                        <Text style={styles.cardTitle}>{post.title}</Text>
                        <Text style={styles.cardCondition}>
                          👫 {post.gender} · 🎂 {post.ages.join(', ')}
                        </Text>
                        <View style={styles.cardBottomRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.cardLocation}>📍 {post.location}</Text>
                            <Text style={styles.cardMeetup}>
                              ⏰ 집결 {formatTimeHHMM(post.meetupMs || post.deadlineMs)}
                            </Text>
                            {post.distance != null && (
                              <Text
                                style={[
                                  styles.cardDistance,
                                  tooFar && { color: '#FF5C5C' },
                                ]}
                              >
                                {tooFar ? '🚫 ' : '📏 '}
                                {formatDistance(post.distance)}
                                {tooFar ? ' · 너무 멀어요' : ''}
                              </Text>
                            )}
                          </View>
                          <View style={styles.cardCounts}>
                            <Text style={styles.participantCount}>
                              👥 {(post.participants || []).length}
                            </Text>
                            <Text style={styles.commentCount}>
                              💬 {post.comments.length}
                            </Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          )}

          {tab === '참여목록' && (
            <View style={{ padding: 20 }}>
              <Text style={styles.headerTitle}>내 활동 및 친구 🛍️</Text>

              <Text style={styles.subLabel}>
                친구 목록 ({(profile.friends || []).length})
              </Text>
              <View style={styles.friendRow}>
                {(profile.friends || []).length === 0 ? (
                  <Text style={styles.emptyDescInline}>
                    아직 친구가 없어요. 댓글이나 주최자 닉네임을 눌러 친구 추가해보세요.
                  </Text>
                ) : (
                  (profile.friends || []).map((name) => (
                    <TouchableOpacity
                      key={name}
                      onPress={() => openUserProfile(name)}
                      style={styles.friendItem}
                    >
                      <View>
                        <Image
                          source={{
                            uri: `https://i.pravatar.cc/100?u=${encodeURIComponent(name)}`,
                          }}
                          style={styles.friendAvatar}
                        />
                        <View style={styles.friendOnlineDot} />
                      </View>
                      <Text style={styles.friendName} numberOfLines={1}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              <Text style={styles.subLabel}>내가 만든 모임 ({myPosts.length})</Text>
              {myPosts.length === 0 ? (
                <Text style={styles.emptyDescInline}>아직 만든 모임이 없어요.</Text>
              ) : (
                myPosts.map((post) => {
                  const t = formatTimeLeft(post.deadlineMs, now);
                  return (
                    <TouchableOpacity
                      key={post.id}
                      style={styles.historyCard}
                      onPress={() => openDetail(post)}
                    >
                      <Text style={styles.historyDate}>{t.text}</Text>
                      <Text style={styles.historyTitle}>{post.title}</Text>
                      <View
                        style={[
                          styles.statusBadge,
                          t.expired && { backgroundColor: '#F0F0F0' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            t.expired && { color: '#888' },
                          ]}
                        >
                          {t.expired ? '종료됨' : '진행 중'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}

              <Text style={styles.subLabel}>
                참여 중인 모임 ({myJoinedActive.length})
              </Text>
              {myJoinedActive.length === 0 ? (
                <Text style={styles.emptyDescInline}>현재 참여 중인 모임이 없어요.</Text>
              ) : (
                myJoinedActive.map((post) => {
                  const t = formatTimeLeft(post.deadlineMs, now);
                  return (
                    <TouchableOpacity
                      key={post.id}
                      style={styles.historyCard}
                      onPress={() => openDetail(post)}
                    >
                      <Text style={styles.historyDate}>{t.text}</Text>
                      <Text style={styles.historyTitle}>{post.title}</Text>
                      <Text style={styles.historySub}>
                        📍 {post.location} · 주최자 {post.author}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}

              <Text style={styles.subLabel}>
                최근 참여 이력 (최근 3일 · {myRecentHistory.length})
              </Text>
              {myRecentHistory.length === 0 ? (
                <Text style={styles.emptyDescInline}>최근 3일간 참여한 모임이 없어요.</Text>
              ) : (
                myRecentHistory.map((post) => {
                  const date = new Date(post.deadlineMs);
                  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date
                    .getHours()
                    .toString()
                    .padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                  const reviewCount = (post.reviews || []).filter(
                    (r) => r.from === profile.nickname,
                  ).length;
                  const totalToReview = (post.participants || []).filter(
                    (n) => n !== profile.nickname,
                  ).length;
                  return (
                    <TouchableOpacity
                      key={post.id}
                      style={styles.historyCard}
                      onPress={() => openDetail(post)}
                    >
                      <Text style={styles.historyDate}>{dateStr} 종료</Text>
                      <Text style={styles.historyTitle}>{post.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <View style={[styles.statusBadge, { backgroundColor: '#F0F0F0' }]}>
                          <Text style={[styles.statusText, { color: '#888' }]}>종료됨</Text>
                        </View>
                        {totalToReview > 0 && (
                          <View
                            style={[
                              styles.statusBadge,
                              {
                                marginLeft: 6,
                                backgroundColor:
                                  reviewCount === totalToReview ? '#E8F5E9' : '#FFF8E1',
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusText,
                                {
                                  color:
                                    reviewCount === totalToReview ? '#4CAF50' : '#F59E0B',
                                },
                              ]}
                            >
                              후기 {reviewCount}/{totalToReview}
                            </Text>
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}

          {tab === '채팅' && (
            <View style={{ padding: 20, paddingBottom: 100 }}>
              <Text style={[styles.headerTitle, { marginBottom: 16 }]}>1:1 채팅 목록 💬</Text>
              <View style={styles.usageBanner}>
                <View style={styles.usageBannerRow}>
                  <Text style={styles.usageBannerLabel}>오늘 대화 인원</Text>
                  <Text style={styles.usageBannerValue}>
                    {peopleSpokenToday} / {DAILY_PEOPLE_LIMIT}명
                  </Text>
                </View>
                <View style={styles.usageBarBg}>
                  <View
                    style={[
                      styles.usageBarFill,
                      {
                        width: `${Math.min(100, (peopleSpokenToday / DAILY_PEOPLE_LIMIT) * 100)}%`,
                        backgroundColor:
                          peopleSpokenToday >= DAILY_PEOPLE_LIMIT ? '#FF5C5C' : '#3182F6',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.usageBannerHint}>
                  💡 1인당 하루 {DAILY_MESSAGES_LIMIT}회까지 대화 가능 · 한도는 매일 자정 초기화
                </Text>
              </View>
              <View style={styles.chatListContainer}>
                {chats.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyEmoji}>💬</Text>
                    <Text style={styles.emptyTitle}>아직 채팅이 없어요</Text>
                  </View>
                ) : (
                  chats.map((c) => {
                    const lastMsg = c.messages[c.messages.length - 1];
                    const partnerIsFriend = isFriend(c.partner);
                    const sentToday = messagesSentTo(c.partner);
                    const remaining = Math.max(0, DAILY_MESSAGES_LIMIT - sentToday);
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[
                          styles.chatRoomItem,
                          !partnerIsFriend && { opacity: 0.55 },
                        ]}
                        onPress={() => openChat(c)}
                      >
                        <Image source={{ uri: c.avatar }} style={styles.chatRoomImg} />
                        <View style={styles.chatRoomInfo}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={styles.chatRoomTitle}>{c.name}</Text>
                            {!partnerIsFriend && (
                              <Text style={styles.lockText}>🔒 친구 아님</Text>
                            )}
                          </View>
                          <Text style={styles.chatRoomMsg} numberOfLines={1}>
                            {lastMsg?.text || ''}
                          </Text>
                          {partnerIsFriend && (
                            <Text style={styles.chatRoomQuota}>
                              오늘 남은 대화 {remaining}/{DAILY_MESSAGES_LIMIT}회
                            </Text>
                          )}
                        </View>
                        <View style={styles.chatRoomMeta}>
                          <Text style={styles.chatRoomTime}>
                            {lastMsg
                              ? new Date(lastMsg.ts).toLocaleTimeString('ko-KR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : ''}
                          </Text>
                          {c.unread > 0 && (
                            <View style={styles.unreadBadge}>
                              <Text style={styles.unreadText}>{c.unread}</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          )}
        </ScrollView>

        <View style={[styles.bottomNav, darkMode && { backgroundColor: '#1E293B', borderColor: '#334155' }]}>
          {[
            { key: '홈', icon: '🏠', label: '홈' },
            { key: '모임', icon: '➕', label: '만들기', isAction: true },
            { key: '참여목록', icon: '📋', label: '참여목록' },
            { key: '채팅', icon: '💬', label: '채팅', badge: totalUnread },
          ].map((it) => (
            <TouchableOpacity
              key={it.key}
              style={styles.navItem}
              onPress={() => (it.isAction ? open('write') : setTab(it.key))}
            >
              <View style={{ position: 'relative' }}>
                <Text
                  style={[
                    styles.navIcon,
                    tab === it.key && !it.isAction && styles.navIconActive,
                  ]}
                >
                  {it.icon}
                </Text>
                {it.badge > 0 && (
                  <View style={styles.navBadge}>
                    <Text style={styles.navBadgeText}>{it.badge}</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.navText,
                  tab === it.key && !it.isAction && styles.navTextActive,
                ]}
              >
                {it.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Profile Modal */}
        <Modal
          visible={modal.profile}
          animationType="slide"
          transparent
          onRequestClose={() => close('profile')}
        >
          <View style={styles.modalBg}>
            <View style={styles.modalHalf}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>내 프로필</Text>
                <TouchableOpacity onPress={() => close('profile')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: 40}}>
              <View style={styles.profileMain}>
                <Image
                  source={{ uri: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' }}
                  style={styles.profileLarge}
                />
                <Text style={styles.profileNickLarge}>{profile.nickname}</Text>
                <Text style={styles.profileInfo}>
                  {profile.ageGroup} · {profile.gender}
                </Text>
                <TouchableOpacity
                  style={styles.editProfileBtn}
                  onPress={() => {
                    setEditNickname(profile.nickname);
                    open('editProfile');
                  }}
                >
                  <Text style={styles.editProfileBtnText}>닉네임 수정</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.trustBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.trustTitle}>
                    내 스파크 지수 ⚡ {computedSpark.spark.toFixed(1)}°
                  </Text>
                  <View
                    style={[
                      styles.levelBadge,
                      { backgroundColor: sparkLevel(computedSpark.spark).color + '20' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.levelBadgeText,
                        { color: sparkLevel(computedSpark.spark).color },
                      ]}
                    >
                      {sparkLevel(computedSpark.spark).name}
                    </Text>
                  </View>
                </View>
                <View style={styles.barBg}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${computedSpark.spark}%`,
                        backgroundColor: sparkLevel(computedSpark.spark).color,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.sparkBreakdown}>
                  성공 +{computedSpark.success * 0.5}점 · 호스팅 +
                  {(computedSpark.hosted * 0.3).toFixed(1)}점 · 👍+
                  {computedSpark.likes * 0.5}점 / 👎-{computedSpark.dislikes * 1.5}점 ·
                  취소-{computedSpark.cancelled}점
                </Text>
              </View>
              <View style={styles.recordRow}>
                <View style={styles.recordItem}>
                  <Text style={styles.recordNum}>{computedSpark.success}</Text>
                  <Text style={styles.recordLab}>성공</Text>
                </View>
                <View style={styles.recordItem}>
                  <Text style={[styles.recordNum, { color: '#3182F6' }]}>
                    {computedSpark.hosted}
                  </Text>
                  <Text style={styles.recordLab}>호스팅</Text>
                </View>
                <View style={styles.recordItem}>
                  <Text style={[styles.recordNum, { color: '#FF5C5C' }]}>
                    {computedSpark.cancelled}
                  </Text>
                  <Text style={styles.recordLab}>취소</Text>
                </View>
              </View>

              <View style={styles.settingsBox}>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>🌙 다크모드 (베타)</Text>
                  <Switch
                    value={darkMode}
                    onValueChange={setDarkMode}
                    trackColor={{ true: '#3182F6', false: '#CCC' }}
                  />
                </View>
                {isAdmin ? (
                  <TouchableOpacity
                    style={styles.adminEntryBtn}
                    onPress={() => {
                      close('profile');
                      open('admin');
                    }}
                  >
                    <Text style={styles.adminEntryText}>🛠 관리자 모드</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.uidBox}
                  onPress={async () => {
                    if (!uid) return;
                    try {
                      await Clipboard.setStringAsync(uid);
                      Alert.alert(
                        'UID 복사됨',
                        '관리자로 등록하려면 Firebase Console → Firestore → admins 컬렉션에 이 UID로 문서를 추가하세요.',
                      );
                    } catch (e) {
                      Alert.alert('UID', uid);
                    }
                  }}
                >
                  <Text style={styles.uidLabel}>내 UID (탭하면 복사)</Text>
                  <Text style={styles.uidValue}>
                    {uid ? `${uid.slice(0, 12)}...` : '로딩...'}
                  </Text>
                </TouchableOpacity>
                {Platform.OS === 'web' &&
                  typeof Notification !== 'undefined' &&
                  Notification.permission !== 'granted' && (
                    <TouchableOpacity
                      style={styles.notifPermBtn}
                      onPress={async () => {
                        try {
                          const result = await Notification.requestPermission();
                          if (result === 'granted') {
                            Alert.alert(
                              '알림 켜짐',
                              '마감 임박/곧 시작 알림을 브라우저로 받게 돼요.',
                            );
                          }
                        } catch (e) {}
                      }}
                    >
                      <Text style={styles.notifPermText}>🔔 푸시 알림 받기</Text>
                    </TouchableOpacity>
                  )}
              </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Edit Profile Modal */}
        <Modal
          visible={modal.editProfile}
          animationType="fade"
          transparent
          onRequestClose={() => close('editProfile')}
        >
          <View style={styles.modalBg}>
            <View style={[styles.modalHalf, { height: '40%' }]}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>닉네임 수정</Text>
                <TouchableOpacity onPress={() => close('editProfile')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.label}>닉네임</Text>
              <TextInput
                style={styles.input}
                value={editNickname}
                onChangeText={setEditNickname}
                placeholder="닉네임 입력"
                maxLength={20}
              />
              {profile.lastNicknameChangeAt &&
                Date.now() - profile.lastNicknameChangeAt < 30 * 24 * 60 * 60 * 1000 ? (
                <View style={styles.lockedNotice}>
                  <Text style={styles.lockedNoticeText}>
                    ⚠️ 닉네임은 30일에 1번만 변경할 수 있어요. 다음 변경 가능:{' '}
                    {new Date(
                      profile.lastNicknameChangeAt + 30 * 24 * 60 * 60 * 1000,
                    ).toLocaleDateString('ko-KR')}
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  profile.lastNicknameChangeAt &&
                    Date.now() - profile.lastNicknameChangeAt < 30 * 24 * 60 * 60 * 1000 &&
                    { backgroundColor: '#CCC' },
                ]}
                onPress={() => {
                  if (!editNickname.trim()) return;
                  if (editNickname.trim() === profile.nickname) {
                    close('editProfile');
                    return;
                  }
                  if (
                    profile.lastNicknameChangeAt &&
                    Date.now() - profile.lastNicknameChangeAt < 30 * 24 * 60 * 60 * 1000
                  ) {
                    Alert.alert(
                      '변경 불가',
                      '닉네임은 30일에 한 번만 변경할 수 있어요.',
                    );
                    return;
                  }
                  updateProfile({
                    ...profile,
                    nickname: editNickname.trim(),
                    lastNicknameChangeAt: Date.now(),
                  });
                  close('editProfile');
                }}
              >
                <Text style={styles.submitBtnText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Write Modal */}
        <Modal
          visible={modal.write}
          animationType="slide"
          transparent
          onRequestClose={() => close('write')}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalBg}
          >
            <View style={styles.modalFull}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>새로운 모임 열기 ⚡</Text>
                <TouchableOpacity onPress={() => close('write')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {(() => {
                  const todayCount = posts.filter(
                    (p) =>
                      p.author === profile.nickname &&
                      p.createdAt &&
                      isSameDay(p.createdAt, Date.now()),
                  ).length;
                  return (
                    <View style={styles.dailyQuotaBox}>
                      <Text style={styles.dailyQuotaText}>
                        오늘 작성한 모임 {todayCount} / {DAILY_POST_LIMIT}
                      </Text>
                      <View style={styles.dailyQuotaBarBg}>
                        <View
                          style={[
                            styles.dailyQuotaBarFill,
                            {
                              width: `${Math.min(100, (todayCount / DAILY_POST_LIMIT) * 100)}%`,
                              backgroundColor:
                                todayCount >= DAILY_POST_LIMIT ? '#FF5C5C' : '#3182F6',
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })()}

                <Text style={styles.label}>마감 시간 설정</Text>
                <View style={styles.chipRow}>
                  {[30, 45, 60, 90, 120].map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.chip, form.limitTime === t && styles.chipOn]}
                      onPress={() => updateForm('limitTime', t)}
                    >
                      <Text
                        style={[styles.chipTxt, form.limitTime === t && styles.chipTxtOn]}
                      >
                        {t}분
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>만나는 시간</Text>
                {(() => {
                  const parsed = parseHHMM(form.meetupTime);
                  const nowDate = new Date();
                  const selH = parsed ? parsed.h : nowDate.getHours();
                  const selM = parsed
                    ? parsed.min
                    : Math.floor(nowDate.getMinutes() / 15) * 15;
                  const updateTime = (h, m) => {
                    updateForm(
                      'meetupTime',
                      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
                    );
                  };
                  const hours = Array.from({ length: 24 }, (_, i) => i);
                  const minutes = [0, 15, 30, 45];
                  return (
                    <View style={styles.wheelRow}>
                      <WheelPicker
                        items={hours}
                        value={selH}
                        onChange={(h) => updateTime(h, selM)}
                      />
                      <Text style={styles.wheelColonNew}>:</Text>
                      <WheelPicker
                        items={minutes}
                        value={selM}
                        onChange={(m) => updateTime(selH, m)}
                      />
                      <View style={styles.wheelMeta}>
                        <Text style={styles.wheelMetaLabel}>
                          {form.meetupTime || `${String(selH).padStart(2, '0')}:${String(selM).padStart(2, '0')} (자동)`}
                        </Text>
                        {form.meetupTime ? (
                          <TouchableOpacity
                            style={styles.wheelClearBtn}
                            onPress={() => updateForm('meetupTime', '')}
                          >
                            <Text style={{ color: '#888', fontSize: 11 }}>초기화</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  );
                })()}
                <Text style={styles.mapHint}>
                  💡 비워두면 마감 +15분 자동. 마감보다 빠른 시각이면 다음날로 이동돼요.
                </Text>

                <Text style={styles.label}>참여 인원</Text>
                <View style={styles.chipRow}>
                  {CAPACITY_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.label}
                      style={[styles.chip, form.capacity === opt.value && styles.chipOn]}
                      onPress={() => updateForm('capacity', opt.value)}
                    >
                      <Text
                        style={[
                          styles.chipTxt,
                          form.capacity === opt.value && styles.chipTxtOn,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>어떤 모임인가요?</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.chipScroll}
                >
                  {CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.chip,
                        form.category === cat && styles.chipOn,
                        { marginRight: 8 },
                      ]}
                      onPress={() => updateForm('category', cat)}
                    >
                      <Text
                        style={[styles.chipTxt, form.category === cat && styles.chipTxtOn]}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.label}>참여 성별</Text>
                <View style={styles.chipRow}>
                  {['누구나', '남성만', '여성만'].map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[styles.chip, form.gender === g && styles.chipOn]}
                      onPress={() => updateForm('gender', g)}
                    >
                      <Text style={[styles.chipTxt, form.gender === g && styles.chipTxtOn]}>
                        {g}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>참여 연령대 (중복 선택)</Text>
                <View style={styles.chipRowWrap}>
                  {['연령무관', '10대', '20대', '30대', '40대+'].map((a) => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.chip, form.ages.includes(a) && styles.chipOn]}
                      onPress={() => toggleAge(a)}
                    >
                      <Text
                        style={[styles.chipTxt, form.ages.includes(a) && styles.chipTxtOn]}
                      >
                        {a}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>제목</Text>
                <TextInput
                  style={styles.input}
                  placeholder="제목 입력"
                  value={form.title}
                  onChangeText={(t) => updateForm('title', t)}
                  maxLength={50}
                />
                <Text style={styles.charCount}>{form.title.length}/50</Text>

                <Text style={styles.label}>만날 장소 (텍스트)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="예) 여의나루역 2번 출구 앞"
                  value={form.location}
                  onChangeText={(t) => updateForm('location', t)}
                />

                <Text style={styles.label}>지도에서 위치 선택</Text>
                <MapView
                  height={220}
                  center={pickedLocation || userLocation}
                  selected={pickedLocation}
                  userLocation={userLocation}
                  onPick={(loc) => setPickedLocation(loc)}
                />
                <Text style={styles.mapHint}>
                  지도를 탭하면 핀이 찍혀요. 비워두면 내 현재 위치로 등록돼요.
                </Text>

                <Text style={styles.label}>대표 사진 (선택)</Text>
                {pickedImage ? (
                  <View style={{ marginBottom: 8 }}>
                    <Image source={{ uri: pickedImage }} style={styles.previewImage} />
                    <TouchableOpacity
                      style={styles.imageRemoveBtn}
                      onPress={() => setPickedImage(null)}
                    >
                      <Text style={styles.imageRemoveText}>사진 제거</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.imagePickBtn} onPress={handlePickImage}>
                    <Text style={styles.imagePickText}>📷 사진 선택</Text>
                  </TouchableOpacity>
                )}

                <Text style={styles.label}>상세 내용 (선택)</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  placeholder="모임 설명, 준비물, 페이스 등 자유롭게 작성해주세요"
                  value={form.description}
                  onChangeText={(t) => updateForm('description', t)}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  maxLength={300}
                />
                <Text style={styles.charCount}>{form.description.length}/300</Text>

                <TouchableOpacity style={styles.submitBtn} onPress={handleAddPost}>
                  <Text style={styles.submitBtnText}>모임 만들기</Text>
                </TouchableOpacity>
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Detail Modal */}
        <Modal
          visible={modal.detail}
          animationType="fade"
          transparent
          onRequestClose={() => close('detail')}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalBg}
          >
            <View style={styles.modalFull}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>모임 상세 정보</Text>
                <TouchableOpacity onPress={() => close('detail')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              {activePost && (() => {
                const colors = getCategoryColor(activePost.category);
                const t = formatTimeLeft(activePost.deadlineMs, now);
                const isMine = activePost.author === profile.nickname;
                const participants = activePost.participants || [];
                const cancelled = activePost.cancelled || [];
                const isJoined = participants.includes(profile.nickname);
                const isCancelled = cancelled.includes(profile.nickname);
                return (
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View
                      style={[
                        styles.tagContainer,
                        { backgroundColor: colors.bg, alignSelf: 'flex-start', marginBottom: 12 },
                      ]}
                    >
                      <Text style={[styles.tagText, { color: colors.color }]}>
                        {activePost.category}
                      </Text>
                    </View>
                    <Text style={styles.detailTitle}>{activePost.title}</Text>
                    <Text
                      style={[
                        styles.detailMeta,
                        t.urgent && styles.timeAlertUrgent,
                        t.expired && styles.timeAlertExpired,
                      ]}
                    >
                      {t.text}
                    </Text>
                    <View style={styles.detailInfo}>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>👫 성별</Text>
                        <Text style={styles.detailValue}>{activePost.gender}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>🎂 연령</Text>
                        <Text style={styles.detailValue}>{activePost.ages.join(', ')}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>📍 장소</Text>
                        <Text style={styles.detailValue}>{activePost.location}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>⏰ 만남 시간</Text>
                        <Text style={styles.detailValue}>
                          {activePost.meetupMs
                            ? formatTimeHHMM(activePost.meetupMs)
                            : formatTimeHHMM(activePost.deadlineMs)}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>👥 정원</Text>
                        <Text style={styles.detailValue}>
                          {formatCapacity(activePost.capacity)}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>👤 주최자</Text>
                        <TouchableOpacity
                          onPress={() => openUserProfile(activePost.author)}
                          disabled={activePost.author === profile.nickname}
                          style={{ flex: 1 }}
                        >
                          <Text
                            style={[
                              styles.detailValue,
                              activePost.author !== profile.nickname && styles.commentUserLink,
                            ]}
                          >
                            {activePost.author}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {activePost.image ? (
                      <Image
                        source={{ uri: activePost.image }}
                        style={styles.detailImage}
                      />
                    ) : null}

                    {activePost.lat != null && activePost.lng != null ? (
                      <View style={styles.detailMapWrapper}>
                        <MapView
                          height={220}
                          center={{ lat: activePost.lat, lng: activePost.lng }}
                          markers={[
                            {
                              id: activePost.id,
                              lat: activePost.lat,
                              lng: activePost.lng,
                              title: activePost.title,
                              location: activePost.location,
                            },
                          ]}
                          enroute={(activePost.enroute || []).filter(
                            (e) =>
                              !(activePost.arrivals || []).some((a) => a.user === e.user),
                          )}
                          arrivals={(activePost.arrivals || []).map((a) => {
                            const er = (activePost.enroute || []).find(
                              (e) => e.user === a.user,
                            );
                            return er ? { ...a, lat: er.lat, lng: er.lng } : a;
                          })}
                          userLocation={userLocation}
                          zoom={15}
                        />
                        {(() => {
                          const d = distanceKm(userLocation, {
                            lat: activePost.lat,
                            lng: activePost.lng,
                          });
                          const tooFar = d != null && d > NEARBY_RADIUS_KM;
                          return (
                            <View
                              style={[
                                styles.detailDistanceBar,
                                tooFar && { backgroundColor: '#FFE5E5' },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.detailDistanceText,
                                  tooFar && { color: '#FF5C5C' },
                                ]}
                              >
                                내 위치에서 {formatDistance(d)}{' '}
                                {tooFar ? `· ${NEARBY_RADIUS_KM}km 초과 (참여 불가)` : '· 참여 가능 거리'}
                              </Text>
                            </View>
                          );
                        })()}
                      </View>
                    ) : null}

                    {activePost.description ? (
                      <View style={styles.descriptionBox}>
                        <Text style={styles.descriptionLabel}>📝 상세 내용</Text>
                        <Text style={styles.descriptionText}>
                          {activePost.description}
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.participantsBox}>
                      <Text style={styles.participantsLabel}>
                        참여자 ({participants.length}
                        {activePost.capacity != null ? `/${activePost.capacity}` : ''}
                        {activePost.capacity == null ? ' · 정원 ∞' : ''})
                      </Text>
                      {participants.length === 0 ? (
                        <Text style={styles.emptyDescInline}>아직 참여자가 없어요.</Text>
                      ) : (
                        <View style={styles.participantChips}>
                          {participants.map((name) => (
                            <TouchableOpacity
                              key={name}
                              style={styles.participantChip}
                              onPress={() => openUserProfile(name)}
                              disabled={name === profile.nickname}
                            >
                              <Text style={styles.participantChipText}>
                                {name === profile.nickname ? `${name} (나)` : name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>

                    {isMine &&
                      (activePost.joinRequests || []).filter((r) => r.status === 'pending')
                        .length > 0 && (
                        <View style={styles.joinReqBox}>
                          <Text style={styles.joinReqLabel}>
                            📨 참여 요청 (
                            {
                              (activePost.joinRequests || []).filter(
                                (r) => r.status === 'pending',
                              ).length
                            }
                            건)
                          </Text>
                          {(activePost.joinRequests || [])
                            .filter((r) => r.status === 'pending')
                            .map((r) => (
                              <View key={r.user} style={styles.joinReqRow}>
                                <TouchableOpacity
                                  style={{ flex: 1 }}
                                  onPress={() => openUserProfile(r.user)}
                                >
                                  <Text style={styles.joinReqName}>{r.user}</Text>
                                  <Text style={styles.joinReqMeta}>
                                    {new Date(r.ts).toLocaleString('ko-KR', {
                                      month: 'numeric',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.joinReqAcceptBtn}
                                  onPress={() => openRequestAction(r.user, 'accept')}
                                >
                                  <Text style={styles.joinReqAcceptText}>수락</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.joinReqRejectBtn}
                                  onPress={() => openRequestAction(r.user, 'reject')}
                                >
                                  <Text style={styles.joinReqRejectText}>거절</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                        </View>
                      )}

                    {!isMine && !t.expired && (() => {
                      const myArrival = (activePost.arrivals || []).find(
                        (a) => a.user === profile.nickname,
                      );
                      const myEnroute = (activePost.enroute || []).find(
                        (e) => e.user === profile.nickname,
                      );
                      const myRequest = (activePost.joinRequests || []).find(
                        (r) => r.user === profile.nickname,
                      );
                      const distNow =
                        activePost.lat != null && activePost.lng != null
                          ? distanceKm(userLocation, {
                              lat: activePost.lat,
                              lng: activePost.lng,
                            })
                          : null;
                      const tooFarForJoin = distNow != null && distNow > NEARBY_RADIUS_KM;

                      if (
                        !isJoined &&
                        !isCancelled &&
                        tooFarForJoin &&
                        !myRequest
                      ) {
                        return (
                          <View style={{ marginTop: 16 }}>
                            <View style={styles.farRequestBox}>
                              <Text style={styles.farRequestText}>
                                📍 {formatDistance(distNow)} 떨어져 있어 자동 참여는 안 되지만,
                                호스트에게 직접 요청해볼 수 있어요.
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[styles.joinButton, { backgroundColor: '#22C55E' }]}
                              onPress={handleSendJoinRequest}
                            >
                              <Text style={styles.joinButtonText}>
                                📨 호스트에게 참여 요청
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      }

                      if (myRequest && myRequest.status === 'pending') {
                        return (
                          <View style={[styles.disabledJoinButton, { marginTop: 16 }]}>
                            <Text style={styles.disabledJoinText}>
                              ⏳ 호스트 응답 대기 중
                            </Text>
                          </View>
                        );
                      }
                      if (myRequest && myRequest.status === 'rejected') {
                        return (
                          <View
                            style={[
                              styles.disabledJoinButton,
                              { marginTop: 16, backgroundColor: '#FFE5E5' },
                            ]}
                          >
                            <Text style={[styles.disabledJoinText, { color: '#FF5C5C' }]}>
                              ❌ 호스트가 거절했어요
                            </Text>
                            {myRequest.hostMessage ? (
                              <Text style={[styles.disabledJoinText, { fontSize: 11, marginTop: 6 }]}>
                                "{myRequest.hostMessage}"
                              </Text>
                            ) : null}
                          </View>
                        );
                      }

                      return (
                        <View style={{ marginTop: 16 }}>
                          {myRequest && myRequest.status === 'accepted' && myRequest.hostMessage ? (
                            <View style={styles.acceptedMessageBox}>
                              <Text style={styles.acceptedMessageText}>
                                💬 호스트: "{myRequest.hostMessage}"
                              </Text>
                            </View>
                          ) : null}
                          {isJoined ? (
                            <>
                              <View style={styles.statusStepRow}>
                                <View style={styles.statusStepDone}>
                                  <Text style={styles.statusStepDoneText}>✓ 1. 신청</Text>
                                </View>
                                <View
                                  style={
                                    myEnroute
                                      ? styles.statusStepDone
                                      : styles.statusStepPending
                                  }
                                >
                                  <Text
                                    style={
                                      myEnroute
                                        ? styles.statusStepDoneText
                                        : styles.statusStepPendingText
                                    }
                                  >
                                    {myEnroute ? '✓' : '○'} 2. 가는 중
                                  </Text>
                                </View>
                                <View
                                  style={
                                    myArrival
                                      ? styles.statusStepDone
                                      : styles.statusStepPending
                                  }
                                >
                                  <Text
                                    style={
                                      myArrival
                                        ? styles.statusStepDoneText
                                        : styles.statusStepPendingText
                                    }
                                  >
                                    {myArrival ? '✓' : '○'} 3. 도착
                                  </Text>
                                </View>
                              </View>

                              <View style={styles.actionRow}>
                                <TouchableOpacity
                                  style={[styles.enrouteButton, { flex: 1, marginRight: 6 }]}
                                  onPress={handleEnRoute}
                                >
                                  <Text style={styles.enrouteButtonText}>
                                    🚶 {myEnroute ? '위치 갱신' : '가는 중'}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.gpsButton, { flex: 1, marginTop: 0 }]}
                                  onPress={handleArrivalProof}
                                >
                                  <Text style={styles.gpsButtonText}>
                                    📷 {myArrival ? '도착 사진 갱신' : '도착 인증'}
                                  </Text>
                                </TouchableOpacity>
                              </View>

                              {myArrival && (
                                <Image
                                  source={{ uri: myArrival.photo }}
                                  style={styles.arrivalPreview}
                                />
                              )}

                              <TouchableOpacity
                                style={styles.cancelJoinButtonFull}
                                onPress={handleCancelJoin}
                              >
                                <Text style={styles.cancelJoinText}>참여 취소</Text>
                              </TouchableOpacity>
                            </>
                          ) : isCancelled ? (
                            <View style={[styles.disabledJoinButton, { flex: 1 }]}>
                              <Text style={styles.disabledJoinText}>
                                취소한 모임은 다시 신청할 수 없어요
                              </Text>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={[styles.joinButton, { flex: 1 }]}
                              onPress={handleJoin}
                            >
                              <Text style={styles.joinButtonText}>
                                ✨ 참여 신청하기
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })()}

                    <View style={styles.commentBox}>
                      <Text style={styles.label}>실시간 소통 ({activePost.comments.length})</Text>
                      {activePost.comments.length === 0 ? (
                        <Text style={styles.emptyDescInline}>첫 댓글을 남겨보세요!</Text>
                      ) : (
                        activePost.comments.map((c) => {
                          const reactions = c.reactions || {};
                          const myReaction = reactions[profile.nickname];
                          const likes = Object.values(reactions).filter(
                            (r) => r === 'like',
                          ).length;
                          const dislikes = Object.values(reactions).filter(
                            (r) => r === 'dislike',
                          ).length;
                          return (
                            <View key={c.id} style={styles.commentItem}>
                              <View style={styles.commentLine}>
                                <TouchableOpacity
                                  onPress={() => openUserProfile(c.user)}
                                  disabled={c.user === profile.nickname}
                                >
                                  <Text
                                    style={[
                                      styles.commentUser,
                                      c.user !== profile.nickname && styles.commentUserLink,
                                    ]}
                                  >
                                    {c.user}:{' '}
                                  </Text>
                                </TouchableOpacity>
                                <Text style={styles.commentText}>{c.text}</Text>
                              </View>
                              <View style={styles.commentReactions}>
                                <TouchableOpacity
                                  style={[
                                    styles.commentReactBtn,
                                    myReaction === 'like' && styles.commentReactBtnLikeOn,
                                  ]}
                                  onPress={() => handleCommentReaction(c.id, 'like')}
                                >
                                  <Text
                                    style={[
                                      styles.commentReactText,
                                      myReaction === 'like' && { color: '#FFF' },
                                    ]}
                                  >
                                    👍 {likes}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.commentReactBtn,
                                    myReaction === 'dislike' && styles.commentReactBtnDislikeOn,
                                  ]}
                                  onPress={() => handleCommentReaction(c.id, 'dislike')}
                                >
                                  <Text
                                    style={[
                                      styles.commentReactText,
                                      myReaction === 'dislike' && { color: '#FFF' },
                                    ]}
                                  >
                                    👎 {dislikes}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })
                      )}
                      <View style={styles.commentInputRow}>
                        <TextInput
                          style={styles.commentInputField}
                          placeholder="댓글 작성"
                          value={commentInput}
                          onChangeText={setCommentInput}
                          onSubmitEditing={handleAddComment}
                          returnKeyType="send"
                        />
                        <TouchableOpacity
                          style={styles.commentSendBtn}
                          onPress={handleAddComment}
                        >
                          <Text style={styles.commentSendText}>전송</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {t.expired && isJoined && (
                      <View style={styles.reviewBox}>
                        <Text style={styles.label}>🌟 종료된 모임 · 참여자 후기</Text>
                        <Text style={styles.reviewHint}>
                          함께한 분들이 어떠셨는지 평가해주세요. 한 번 더 누르면 취소돼요.
                        </Text>
                        {participants.filter((n) => n !== profile.nickname).length === 0 ? (
                          <Text style={styles.emptyDescInline}>
                            평가할 참여자가 없어요.
                          </Text>
                        ) : (
                          participants
                            .filter((n) => n !== profile.nickname)
                            .map((name) => {
                              const myReview = (activePost.reviews || []).find(
                                (r) => r.from === profile.nickname && r.target === name,
                              );
                              return (
                                <View key={name} style={styles.reviewRow}>
                                  <TouchableOpacity
                                    onPress={() => openUserProfile(name)}
                                    style={{ flex: 1 }}
                                  >
                                    <Text style={styles.reviewName}>{name}</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[
                                      styles.reviewBtn,
                                      myReview?.rating === 'like' &&
                                        styles.reviewBtnLikeOn,
                                    ]}
                                    onPress={() => handleReview(name, 'like')}
                                  >
                                    <Text
                                      style={[
                                        styles.reviewBtnText,
                                        myReview?.rating === 'like' && { color: '#FFF' },
                                      ]}
                                    >
                                      👍 좋았어요
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[
                                      styles.reviewBtn,
                                      myReview?.rating === 'dislike' &&
                                        styles.reviewBtnDislikeOn,
                                    ]}
                                    onPress={() => handleReview(name, 'dislike')}
                                  >
                                    <Text
                                      style={[
                                        styles.reviewBtnText,
                                        myReview?.rating === 'dislike' && { color: '#FFF' },
                                      ]}
                                    >
                                      👎 별로
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              );
                            })
                        )}
                      </View>
                    )}

                    <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
                      <Text style={styles.shareBtnText}>🔗 모임 공유하기</Text>
                    </TouchableOpacity>

                    {isMine ? (
                      <View>
                        {!t.expired && (
                          <TouchableOpacity
                            style={styles.closeEarlyBtn}
                            onPress={handleCloseEarly}
                          >
                            <Text style={styles.closeEarlyBtnText}>
                              🏁 지금 모임 종료하기
                            </Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.deleteLink}
                          onPress={() => handleDeletePost(activePost.id)}
                        >
                          <Text style={styles.deleteLinkText}>🗑 모임 삭제하기</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.noShowLink}
                        onPress={openReport}
                      >
                        <Text style={styles.noShowLinkText}>⚠️ 신고하기</Text>
                      </TouchableOpacity>
                    )}
                    <View style={{ height: 30 }} />
                  </ScrollView>
                );
              })()}
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Report Modal */}
        <Modal
          visible={modal.report}
          animationType="slide"
          transparent
          onRequestClose={() => close('report')}
        >
          <View style={styles.modalBg}>
            <View style={[styles.modalHalf, { height: '75%' }]}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>신고하기</Text>
                <TouchableOpacity onPress={() => close('report')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.label}>신고할 유저</Text>
                {(activePost?.participants || [])
                  .filter((n) => n !== profile.nickname)
                  .map((name) => (
                    <TouchableOpacity
                      key={name}
                      style={[
                        styles.reportUserItem,
                        reportTarget === name && styles.reportUserItemOn,
                      ]}
                      onPress={() => setReportTarget(name)}
                    >
                      <Text style={styles.reportUserText}>{name}</Text>
                      {reportTarget === name && (
                        <Text style={{ color: '#FF5C5C', fontSize: 16 }}>✓</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                {(!activePost ||
                  (activePost.participants || []).filter((n) => n !== profile.nickname)
                    .length === 0) && (
                  <Text style={styles.emptyDescInline}>신고할 유저가 없어요.</Text>
                )}

                <Text style={styles.label}>사유 선택</Text>
                {REPORT_REASONS.map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[
                      styles.reportReasonItem,
                      reportReason === r.id && styles.reportReasonItemOn,
                    ]}
                    onPress={() => setReportReason(r.id)}
                  >
                    <Text
                      style={[
                        styles.reportReasonText,
                        reportReason === r.id && { color: '#FFF', fontWeight: '800' },
                      ]}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: '#FF5C5C' }]}
                  onPress={submitReport}
                >
                  <Text style={styles.submitBtnText}>신고 제출</Text>
                </TouchableOpacity>
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Notification Inbox */}
        <Modal
          visible={modal.notifications}
          animationType="slide"
          transparent
          onRequestClose={() => close('notifications')}
        >
          <View style={styles.modalBg}>
            <View style={styles.modalFull}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>알림 🔔</Text>
                <TouchableOpacity onPress={() => close('notifications')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              {notifications.length > 0 && (
                <View style={styles.notifActionRow}>
                  <TouchableOpacity onPress={markAllRead}>
                    <Text style={styles.notifActionText}>모두 읽음</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={clearNotifs}>
                    <Text style={[styles.notifActionText, { color: '#FF5C5C' }]}>
                      전체 삭제
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              <ScrollView showsVerticalScrollIndicator={false}>
                {notifications.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyEmoji}>🔕</Text>
                    <Text style={styles.emptyTitle}>새 알림이 없어요</Text>
                    <Text style={styles.emptyDesc}>
                      마감 임박 / 후기 알림이 여기에 모여요.
                    </Text>
                  </View>
                ) : (
                  notifications.map((n) => (
                    <TouchableOpacity
                      key={n.id}
                      style={[styles.notifItem, !n.read && styles.notifItemUnread]}
                      onPress={() => {
                        markNotifRead(n.id);
                        const post = posts.find((p) => p.id === n.postId);
                        if (post) {
                          setActivePost(post);
                          close('notifications');
                          open('detail');
                        }
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.notifTitle}>{n.title}</Text>
                        <Text style={styles.notifBody}>{n.body}</Text>
                        <Text style={styles.notifTime}>
                          {new Date(n.ts).toLocaleString('ko-KR', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </View>
                      {!n.read && <View style={styles.notifDot} />}
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Map Fullscreen View */}
        <Modal
          visible={modal.mapView}
          animationType="slide"
          transparent
          onRequestClose={() => close('mapView')}
        >
          <View style={styles.modalBg}>
            <View style={styles.modalFull}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>🗺 주변 모임 지도</Text>
                <TouchableOpacity onPress={() => close('mapView')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.mapHint}>
                {locationStatus === 'granted'
                  ? `📍 내 위치 기준 ${NEARBY_RADIUS_KM}km 안의 모임을 보여드려요.`
                  : '⚠️ 위치 권한이 없어 여의도 기준으로 표시중이에요.'}
              </Text>
              <MapView
                height={420}
                center={userLocation}
                userLocation={userLocation}
                showRadius
                radiusKm={NEARBY_RADIUS_KM}
                zoom={17}
                markers={visiblePosts
                  .filter((p) => p.lat != null && p.lng != null)
                  .map((p) => ({
                    id: p.id,
                    lat: p.lat,
                    lng: p.lng,
                    title: p.title,
                    location: p.location,
                  }))}
                onMarkerPress={(m) => {
                  const post = posts.find((p) => p.id === m.id);
                  if (post) {
                    close('mapView');
                    setActivePost(post);
                    open('detail');
                  }
                }}
              />
              <Text style={styles.mapHint}>
                💡 핀을 탭하면 모임 상세로 이동해요.
              </Text>
            </View>
          </View>
        </Modal>

        {/* Admin Mode (Demo) */}
        <Modal
          visible={modal.admin}
          animationType="slide"
          transparent
          onRequestClose={() => close('admin')}
        >
          <View style={styles.modalBg}>
            <View style={styles.modalFull}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>🛠 관리자 모드</Text>
                <TouchableOpacity onPress={() => close('admin')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.adminWarn}>
                  <Text style={styles.adminWarnText}>
                    ⚠️ 데모용 인앱 어드민이에요. 실제 서비스에서는{' '}
                    <Text style={{ fontWeight: '900' }}>별도 웹 어드민 + 백엔드</Text>가 필요합니다 (회원/신고/결제/통계 관리).
                  </Text>
                </View>

                <Text style={styles.label}>📊 통계</Text>
                <View style={styles.adminStatsRow}>
                  <View style={styles.adminStatBox}>
                    <Text style={styles.adminStatNum}>{posts.length}</Text>
                    <Text style={styles.adminStatLab}>전체 모임</Text>
                  </View>
                  <View style={styles.adminStatBox}>
                    <Text style={[styles.adminStatNum, { color: '#3182F6' }]}>
                      {posts.filter((p) => p.deadlineMs > now).length}
                    </Text>
                    <Text style={styles.adminStatLab}>진행 중</Text>
                  </View>
                  <View style={styles.adminStatBox}>
                    <Text style={[styles.adminStatNum, { color: '#888' }]}>
                      {posts.filter((p) => p.deadlineMs <= now).length}
                    </Text>
                    <Text style={styles.adminStatLab}>종료</Text>
                  </View>
                </View>
                <View style={styles.adminStatsRow}>
                  <View style={styles.adminStatBox}>
                    <Text style={[styles.adminStatNum, { color: '#4CAF50' }]}>
                      {Array.from(
                        new Set(posts.flatMap((p) => p.participants || [])),
                      ).length}
                    </Text>
                    <Text style={styles.adminStatLab}>활성 사용자</Text>
                  </View>
                  <View style={styles.adminStatBox}>
                    <Text style={[styles.adminStatNum, { color: '#F59E0B' }]}>
                      {posts.reduce((s, p) => s + (p.comments?.length || 0), 0)}
                    </Text>
                    <Text style={styles.adminStatLab}>총 댓글</Text>
                  </View>
                  <View style={styles.adminStatBox}>
                    <Text style={[styles.adminStatNum, { color: '#FF5C5C' }]}>
                      {posts.reduce(
                        (s, p) =>
                          s +
                          (p.reviews || []).filter((r) => r.rating === 'dislike').length,
                        0,
                      )}
                    </Text>
                    <Text style={styles.adminStatLab}>👎 신고성</Text>
                  </View>
                </View>

                <Text style={styles.label}>📋 모임 관리 (관리자 삭제)</Text>
                {posts.map((p) => (
                  <View key={p.id} style={styles.adminPostRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.adminPostTitle} numberOfLines={1}>
                        {p.title}
                      </Text>
                      <Text style={styles.adminPostMeta}>
                        {p.author} · 👥 {(p.participants || []).length}
                        {p.capacity != null ? `/${p.capacity}` : ''} · 💬{' '}
                        {p.comments.length}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.adminDeleteBtn}
                      onPress={() => {
                        Alert.alert('관리자 삭제', `'${p.title}' 모임을 삭제할까요?`, [
                          { text: '취소', style: 'cancel' },
                          {
                            text: '삭제',
                            style: 'destructive',
                            onPress: () => deletePostFs(p.id).catch(() => {}),
                          },
                        ]);
                      }}
                    >
                      <Text style={styles.adminDeleteText}>삭제</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                <Text style={styles.label}>🏆 인기 호스트 랭킹 (주간)</Text>
                {(() => {
                  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                  const scores = new Map();
                  posts.forEach((p) => {
                    if (!p.author) return;
                    if ((p.createdAt || 0) < weekAgo) return;
                    const cur = scores.get(p.author) || {
                      hosted: 0,
                      participants: 0,
                      likes: 0,
                    };
                    cur.hosted += 1;
                    cur.participants += (p.participants || []).length;
                    (p.reviews || []).forEach((r) => {
                      if (r.target === p.author && r.rating === 'like') cur.likes += 1;
                    });
                    scores.set(p.author, cur);
                  });
                  const ranked = Array.from(scores.entries())
                    .map(([name, s]) => ({
                      name,
                      ...s,
                      score: s.hosted * 1 + s.participants * 0.5 + s.likes * 2,
                    }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 10);
                  if (ranked.length === 0) {
                    return (
                      <Text style={styles.emptyDescInline}>
                        주간 호스트 데이터가 없어요.
                      </Text>
                    );
                  }
                  return ranked.map((r, i) => (
                    <View key={r.name} style={styles.rankRow}>
                      <Text style={styles.rankNum}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rankName}>{r.name}</Text>
                        <Text style={styles.rankMeta}>
                          호스팅 {r.hosted} · 참여자 {r.participants} · 👍 {r.likes}
                        </Text>
                      </View>
                      <Text style={styles.rankScore}>{r.score.toFixed(1)}점</Text>
                    </View>
                  ));
                })()}

                <Text style={styles.label}>📨 최근 신고 (24시간)</Text>
                {(() => {
                  const recent = reportsAgainstMe.filter(
                    (r) => r.ts > Date.now() - 24 * 60 * 60 * 1000,
                  );
                  if (recent.length === 0) {
                    return (
                      <Text style={styles.emptyDescInline}>
                        나에 대한 최근 신고가 없어요. (참고: 어드민에선 본인 데이터만 보임)
                      </Text>
                    );
                  }
                  return recent.map((r) => (
                    <View key={r.id} style={styles.adminPostRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.adminPostTitle}>
                          {r.from} → {r.target}
                        </Text>
                        <Text style={styles.adminPostMeta}>{r.reasonLabel}</Text>
                      </View>
                      <Text style={styles.adminPostMeta}>
                        {new Date(r.ts).toLocaleString('ko-KR')}
                      </Text>
                    </View>
                  ));
                })()}

                <Text style={styles.label}>👥 사용자 활동</Text>
                {(() => {
                  const allUsers = new Map();
                  posts.forEach((p) => {
                    (p.participants || []).forEach((n) => {
                      const cur = allUsers.get(n) || { name: n, joined: 0, hosted: 0 };
                      cur.joined += 1;
                      if (p.author === n) cur.hosted += 1;
                      allUsers.set(n, cur);
                    });
                  });
                  return Array.from(allUsers.values()).map((u) => (
                    <View key={u.name} style={styles.adminUserRow}>
                      <Text style={styles.adminUserName}>{u.name}</Text>
                      <Text style={styles.adminUserMeta}>
                        참여 {u.joined} · 호스팅 {u.hosted}
                      </Text>
                    </View>
                  ));
                })()}

                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Request Action (Accept / Reject with message) */}
        <Modal
          visible={requestAction.visible}
          animationType="fade"
          transparent
          onRequestClose={() =>
            setRequestAction({ visible: false, action: null, user: null, message: '' })
          }
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalBg}
          >
            <View style={[styles.modalHalf, { height: '50%' }]}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>
                  {requestAction.action === 'accept' ? '참여 수락' : '참여 거절'}
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    setRequestAction({
                      visible: false,
                      action: null,
                      user: null,
                      message: '',
                    })
                  }
                >
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.label}>
                <Text style={{ color: '#3182F6' }}>{requestAction.user}</Text>님에게
                {requestAction.action === 'accept' ? ' 환영 메시지' : ' 거절 사유'} (선택)
              </Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder={
                  requestAction.action === 'accept'
                    ? '예) 환영합니다! 19시 정각에 만나요'
                    : '예) 인원이 마감됐어요. 다음 기회에!'
                }
                value={requestAction.message}
                onChangeText={(t) => setRequestAction({ ...requestAction, message: t })}
                multiline
                numberOfLines={3}
                maxLength={150}
                textAlignVertical="top"
              />
              <Text style={styles.charCount}>{requestAction.message.length}/150</Text>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  requestAction.action === 'reject' && { backgroundColor: '#FF5C5C' },
                ]}
                onPress={submitRequestAction}
              >
                <Text style={styles.submitBtnText}>
                  {requestAction.action === 'accept' ? '수락하기' : '거절하기'}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Onboarding */}
        <Modal
          visible={modal.onboarding}
          animationType="fade"
          transparent={false}
          onRequestClose={() => {}}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
            <ScrollView contentContainerStyle={styles.onboardScroll}>
              <View style={styles.onboardHero}>
                <Text style={styles.onboardEmoji}>📍</Text>
                <Text style={styles.onboardLogo}>지금, 여기</Text>
                <Text style={styles.onboardTagline}>
                  내 동네에서 1~2시간 안에 만나는{'\n'}짧고 가벼운 모임
                </Text>
              </View>
              <Text style={styles.label}>닉네임</Text>
              <TextInput
                style={styles.input}
                placeholder="다른 사람에게 보일 닉네임"
                value={profile.nickname}
                onChangeText={(t) => updateProfile({ ...profile, nickname: t })}
                maxLength={20}
              />
              <Text style={styles.label}>연령대</Text>
              <View style={styles.chipRowWrap}>
                {['10대', '20대', '30대', '40대+'].map((a) => (
                  <TouchableOpacity
                    key={a}
                    style={[styles.chip, profile.ageGroup === a && styles.chipOn]}
                    onPress={() => updateProfile({ ...profile, ageGroup: a })}
                  >
                    <Text style={[styles.chipTxt, profile.ageGroup === a && styles.chipTxtOn]}>
                      {a}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>성별</Text>
              <View style={styles.chipRow}>
                {['남성', '여성', '비공개'].map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.chip, profile.gender === g && styles.chipOn]}
                    onPress={() => updateProfile({ ...profile, gender: g })}
                  >
                    <Text style={[styles.chipTxt, profile.gender === g && styles.chipTxtOn]}>
                      {g}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.onboardTerms}>
                <Text style={styles.onboardTermsText}>
                  시작하면 이용약관과 개인정보 처리방침에 동의한 것으로 간주돼요.{'\n'}
                  · 만 14세 미만은 가입할 수 없어요.{'\n'}
                  · 노쇼/폭언/사기 신고 누적 시 이용이 제한될 수 있어요.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={async () => {
                  if (!profile.nickname.trim()) {
                    Alert.alert('알림', '닉네임을 입력해주세요.');
                    return;
                  }
                  await AsyncStorage.setItem(STORAGE.onboarded, '1');
                  close('onboarding');
                }}
              >
                <Text style={styles.submitBtnText}>시작하기</Text>
              </TouchableOpacity>
              <View style={{ height: 40 }} />
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* User Profile Modal (other users) */}
        <Modal
          visible={modal.userProfile}
          animationType="slide"
          transparent
          onRequestClose={() => close('userProfile')}
        >
          <View style={styles.modalBg}>
            <View style={styles.modalHalf}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>유저 프로필</Text>
                <TouchableOpacity onPress={() => close('userProfile')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              {viewingUser && (() => {
                const u = mockUserProfile(viewingUser);
                const friend = isFriend(viewingUser);
                const blocked = isBlocked(viewingUser);
                return (
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={styles.profileMain}>
                      <Image source={{ uri: u.avatar }} style={styles.profileLarge} />
                      <Text style={styles.profileNickLarge}>{u.nickname}</Text>
                      <Text style={styles.profileInfo}>
                        {u.ageGroup} · {u.gender}
                      </Text>
                      {friend && (
                        <View style={styles.friendBadge}>
                          <Text style={styles.friendBadgeText}>👫 친구</Text>
                        </View>
                      )}
                      {blocked && (
                        <View
                          style={[styles.friendBadge, { backgroundColor: '#FFE5E5' }]}
                        >
                          <Text style={[styles.friendBadgeText, { color: '#FF5C5C' }]}>
                            🚫 차단됨
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.trustBox}>
                      <Text style={styles.trustTitle}>
                        스파크 지수 ⚡ {u.spark.toFixed(1)}°
                      </Text>
                      <View style={styles.barBg}>
                        <View style={[styles.barFill, { width: `${u.spark}%` }]} />
                      </View>
                    </View>
                    <View style={styles.recordRow}>
                      <View style={styles.recordItem}>
                        <Text style={styles.recordNum}>{u.success}</Text>
                        <Text style={styles.recordLab}>성공</Text>
                      </View>
                      <View style={styles.recordItem}>
                        <Text style={[styles.recordNum, { color: '#FF5C5C' }]}>
                          {u.noShow}
                        </Text>
                        <Text style={styles.recordLab}>노쇼</Text>
                      </View>
                    </View>
                    {!blocked && (
                      <TouchableOpacity
                        style={[
                          styles.favStarBtn,
                          isFavorite(viewingUser) && styles.favStarBtnOn,
                        ]}
                        onPress={() => toggleFavorite(viewingUser)}
                      >
                        <Text
                          style={[
                            styles.favStarText,
                            isFavorite(viewingUser) && { color: '#FFF' },
                          ]}
                        >
                          {isFavorite(viewingUser)
                            ? '⭐ 즐겨찾기 해제'
                            : '☆ 즐겨찾기 추가'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {friend && !blocked && (
                      <TouchableOpacity
                        style={styles.chatStartBtn}
                        onPress={() => openOrCreateChat(viewingUser)}
                      >
                        <Text style={styles.chatStartBtnText}>💬 1:1 채팅 시작</Text>
                      </TouchableOpacity>
                    )}

                    <View style={styles.userActionRow}>
                      <TouchableOpacity
                        style={[
                          styles.userActionBtn,
                          friend
                            ? styles.userActionBtnSecondary
                            : styles.userActionBtnPrimary,
                          blocked && styles.userActionBtnDisabled,
                        ]}
                        onPress={() => !blocked && toggleFriend(viewingUser)}
                        disabled={blocked}
                      >
                        <Text
                          style={[
                            styles.userActionBtnText,
                            friend && styles.userActionBtnTextSecondary,
                            blocked && styles.userActionBtnTextDisabled,
                          ]}
                        >
                          {friend ? '친구 끊기' : '＋ 친구 추가'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.userActionBtn,
                          styles.userActionBtnDanger,
                        ]}
                        onPress={() => toggleBlock(viewingUser)}
                      >
                        <Text style={[styles.userActionBtnText, { color: '#FF5C5C' }]}>
                          {blocked ? '차단 해제' : '🚫 차단'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                );
              })()}
            </View>
          </View>
        </Modal>

        {/* Chat Detail Modal */}
        <Modal
          visible={modal.chat}
          animationType="slide"
          transparent
          onRequestClose={() => close('chat')}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalBg}
          >
            <View style={styles.modalFull}>
              <View style={styles.modalHead}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  {activeChat && (
                    <Image
                      source={{ uri: activeChat.avatar }}
                      style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }}
                    />
                  )}
                  <Text style={styles.modalTitle}>{activeChat?.name || ''}</Text>
                </View>
                <TouchableOpacity onPress={() => close('chat')}>
                  <Text style={styles.xBtn}>✕</Text>
                </TouchableOpacity>
              </View>
              {activeChat && (() => {
                const partner = activeChat.partner;
                const partnerIsFriend = isFriend(partner);
                const sentToday = messagesSentTo(partner);
                const remaining = Math.max(0, DAILY_MESSAGES_LIMIT - sentToday);
                const hitMessageCap = sentToday >= DAILY_MESSAGES_LIMIT;
                const hitPeopleCap =
                  !chatUsage.chatPeople.includes(partner) &&
                  chatUsage.chatPeople.length >= DAILY_PEOPLE_LIMIT;
                const blockedSend = !partnerIsFriend || hitMessageCap || hitPeopleCap;

                return (
                  <>
                    {partnerIsFriend ? (
                      <View style={styles.chatQuotaBar}>
                        <Text style={styles.chatQuotaText}>
                          오늘 남은 대화 · {remaining}/{DAILY_MESSAGES_LIMIT}회
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.chatQuotaBar,
                          { backgroundColor: '#FFF0F0' },
                        ]}
                      >
                        <Text style={[styles.chatQuotaText, { color: '#FF5C5C' }]}>
                          🔒 친구 추가 후에 대화할 수 있어요
                        </Text>
                      </View>
                    )}

                    <ScrollView
                      style={{ flex: 1 }}
                      contentContainerStyle={{ paddingBottom: 20 }}
                    >
                      {activeChat.messages.map((m) => (
                        <View
                          key={m.id}
                          style={[
                            styles.msgRow,
                            m.sender === 'me' ? styles.msgRowMe : styles.msgRowThem,
                          ]}
                        >
                          <View
                            style={[
                              styles.msgBubble,
                              m.sender === 'me' ? styles.msgBubbleMe : styles.msgBubbleThem,
                            ]}
                          >
                            <Text
                              style={[
                                styles.msgText,
                                m.sender === 'me' && { color: '#FFF' },
                              ]}
                            >
                              {m.text}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </ScrollView>

                    {blockedSend && partnerIsFriend && (
                      <View style={styles.premiumTeaser}>
                        <Text style={styles.premiumTeaserTitle}>
                          {hitMessageCap
                            ? `오늘 ${DAILY_MESSAGES_LIMIT}회 한도 도달`
                            : `오늘 ${DAILY_PEOPLE_LIMIT}명 인원 한도 도달`}
                        </Text>
                        <Text style={styles.premiumTeaserDesc}>
                          💎 곧 광고 시청 / 프리미엄으로 한도를 늘릴 수 있어요
                        </Text>
                      </View>
                    )}

                    <View style={styles.chatInputRow}>
                      <TextInput
                        style={[styles.chatInput, blockedSend && styles.chatInputDisabled]}
                        placeholder={
                          !partnerIsFriend
                            ? '친구 추가 후 대화 가능'
                            : hitMessageCap
                            ? '오늘 대화 한도 도달'
                            : hitPeopleCap
                            ? '오늘 대화 인원 한도 도달'
                            : '메시지 입력...'
                        }
                        value={chatInput}
                        onChangeText={setChatInput}
                        onSubmitEditing={handleSendChat}
                        returnKeyType="send"
                        editable={!blockedSend}
                      />
                      <TouchableOpacity
                        style={[
                          styles.chatSendBtn,
                          blockedSend && { backgroundColor: '#CCC' },
                        ]}
                        onPress={handleSendChat}
                        disabled={blockedSend}
                      >
                        <Text style={styles.chatSendText}>전송</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                );
              })()}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFF' },
  container: { flex: 1, backgroundColor: '#F2F4F6' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFF',
  },
  logoText: { fontSize: 20, fontWeight: '900', color: '#3182F6' },
  profileBox: { flexDirection: 'row', alignItems: 'center' },
  profileTextContainer: { alignItems: 'flex-end', marginRight: 10 },
  profileNickname: { fontSize: 13, fontWeight: '800', color: '#191F28' },
  profileInfo: { fontSize: 11, color: '#888' },
  profileImg: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EEE' },
  contentScroll: { flex: 1 },
  hero: {
    margin: 16,
    marginBottom: 8,
    borderRadius: 20,
    backgroundColor: '#3182F6',
    padding: 22,
    overflow: 'hidden',
    shadowColor: '#3182F6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  heroGlow1: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroGlow2: {
    position: 'absolute',
    bottom: -40,
    left: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroContent: {},
  heroLocationRow: { flexDirection: 'row', alignItems: 'baseline' },
  heroLocationText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  heroLocationSub: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginLeft: 6,
  },
  heroNumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  heroBigNum: {
    color: '#FFF',
    fontSize: 56,
    fontWeight: '900',
    lineHeight: 60,
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 12,
    marginBottom: 6,
    lineHeight: 18,
  },
  heroDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginVertical: 14,
  },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center' },
  heroStatItem: { flex: 1 },
  heroStatLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  heroStatValue: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  heroStatDivider: {
    width: 1,
    height: 26,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginHorizontal: 14,
  },
  filterScroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#FFF',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  filterChipOn: { backgroundColor: '#3182F6', borderColor: '#3182F6' },
  filterChipText: { fontSize: 12, color: '#666' },
  filterChipTextOn: { color: '#FFF', fontWeight: '800' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#191F28' },
  headerSub: { fontSize: 12, color: '#888' },
  card: {
    backgroundColor: '#FFF',
    padding: 20,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardExpired: { opacity: 0.5 },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  tagContainer: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '700' },
  timeAlert: { fontSize: 11, color: '#888', fontWeight: '700' },
  timeAlertUrgent: { color: '#FF5C5C' },
  timeAlertExpired: { color: '#999' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6, color: '#191F28' },
  cardCondition: { fontSize: 11, color: '#888', marginBottom: 12 },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLocation: { fontSize: 12, color: '#666' },
  cardMeetup: { fontSize: 12, color: '#3182F6', fontWeight: '700', marginTop: 2 },
  cardCounts: { flexDirection: 'row', alignItems: 'center' },
  radiusToggleRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  radiusToggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#EEE',
    alignItems: 'center',
  },
  radiusToggleBtnOn: { backgroundColor: '#3182F6', borderColor: '#3182F6' },
  radiusToggleText: { fontSize: 13, color: '#666', fontWeight: '700' },
  radiusToggleTextOn: { color: '#FFF', fontWeight: '800' },
  viewRadiusHint: {
    fontSize: 11,
    color: '#888',
    paddingHorizontal: 20,
    marginBottom: 10,
    lineHeight: 16,
  },
  participantCount: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '800',
    marginRight: 10,
  },
  commentCount: { fontSize: 12, color: '#3182F6', fontWeight: '800' },
  emptyState: { paddingVertical: 40, alignItems: 'center' },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#191F28', marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#888', marginBottom: 16 },
  emptyDescInline: { fontSize: 13, color: '#888', marginBottom: 8 },
  emptyBtn: {
    backgroundColor: '#3182F6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyBtnText: { color: '#FFF', fontWeight: '800' },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderColor: '#EEE',
    justifyContent: 'space-around',
  },
  navItem: { alignItems: 'center', minWidth: 60 },
  navIcon: { fontSize: 22, opacity: 0.4, marginBottom: 4, textAlign: 'center' },
  navIconActive: { opacity: 1 },
  navText: { fontSize: 10, color: '#888' },
  navTextActive: { color: '#3182F6', fontWeight: '800' },
  navBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#FF5C5C',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBadgeText: { color: '#FFF', fontSize: 9, fontWeight: '700' },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalHalf: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    height: '70%',
  },
  modalFull: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    height: '92%',
    flex: 1,
  },
  modalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '900', color: '#191F28' },
  xBtn: { fontSize: 24, color: '#AAA', paddingHorizontal: 8 },
  label: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 10,
    color: '#191F28',
  },
  chipScroll: { marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chipRowWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#EEE',
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { backgroundColor: '#3182F6', borderColor: '#3182F6' },
  chipTxt: { fontSize: 12, color: '#666' },
  chipTxtOn: { color: '#FFF', fontWeight: '800' },
  input: {
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 8,
    fontSize: 14,
  },
  inputMultiline: { height: 100, paddingTop: 14 },
  charCount: { fontSize: 11, color: '#AAA', alignSelf: 'flex-end' },
  descriptionBox: {
    marginTop: 16,
    backgroundColor: '#FFFCF0',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  descriptionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#92400E',
    marginBottom: 6,
  },
  descriptionText: { fontSize: 13, color: '#333', lineHeight: 20 },
  reviewBox: {
    marginTop: 24,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
  },
  reviewHint: { fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 18 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 6,
  },
  reviewName: { fontSize: 14, fontWeight: '700', color: '#191F28' },
  reviewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E8EB',
    marginLeft: 6,
  },
  reviewBtnLikeOn: { backgroundColor: '#3182F6', borderColor: '#3182F6' },
  reviewBtnDislikeOn: { backgroundColor: '#FF5C5C', borderColor: '#FF5C5C' },
  reviewBtnText: { fontSize: 12, fontWeight: '700', color: '#666' },
  historySub: { fontSize: 12, color: '#888', marginTop: 2 },
  submitBtn: {
    backgroundColor: '#3182F6',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  submitBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  profileMain: { alignItems: 'center', marginVertical: 16 },
  profileLarge: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#EEE' },
  profileNickLarge: { fontSize: 20, fontWeight: '900', marginTop: 10, color: '#191F28' },
  editProfileBtn: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F0F4FF',
  },
  editProfileBtnText: { color: '#3182F6', fontSize: 12, fontWeight: '800' },
  trustBox: { backgroundColor: '#F8F9FA', padding: 18, borderRadius: 16, marginTop: 8 },
  trustTitle: { fontWeight: '800', fontSize: 14, color: '#191F28' },
  barBg: {
    height: 8,
    backgroundColor: '#EEE',
    borderRadius: 4,
    marginTop: 10,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: '#FF5C5C', borderRadius: 4 },
  recordRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 24 },
  recordItem: { alignItems: 'center' },
  recordNum: { fontSize: 24, fontWeight: '900', color: '#191F28' },
  recordLab: { fontSize: 12, color: '#888', marginTop: 4 },
  subLabel: { fontSize: 14, fontWeight: '800', marginBottom: 12, marginTop: 24, color: '#191F28' },
  friendRow: { flexDirection: 'row', alignItems: 'center' },
  friendImg: { width: 48, height: 48, borderRadius: 24, marginRight: 14, backgroundColor: '#EEE' },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 14,
    width: 12,
    height: 12,
    backgroundColor: '#4CAF50',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  addFriendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEE',
    marginBottom: 8,
  },
  historyDate: { fontSize: 11, color: '#AAA' },
  historyTitle: { fontSize: 14, fontWeight: '700', marginVertical: 6, color: '#191F28' },
  statusBadge: {
    backgroundColor: '#E8F3FF',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: { color: '#3182F6', fontSize: 11, fontWeight: '800' },
  detailTitle: { fontSize: 22, fontWeight: '900', color: '#191F28' },
  detailMeta: { fontSize: 13, color: '#888', marginTop: 6 },
  detailInfo: { backgroundColor: '#F8F9FA', borderRadius: 12, padding: 14, marginTop: 16 },
  detailRow: { flexDirection: 'row', paddingVertical: 6 },
  detailLabel: { fontSize: 13, color: '#888', width: 80 },
  detailValue: { fontSize: 13, color: '#191F28', flex: 1, fontWeight: '600' },
  gpsButton: {
    backgroundColor: '#3182F6',
    padding: 15,
    borderRadius: 12,
    marginTop: 16,
    alignItems: 'center',
  },
  gpsButtonText: { color: '#FFF', fontWeight: '800' },
  participantsBox: {
    marginTop: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
  },
  participantsLabel: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 10,
    color: '#191F28',
  },
  participantChips: { flexDirection: 'row', flexWrap: 'wrap' },
  participantChip: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E8EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    marginRight: 6,
    marginBottom: 6,
  },
  participantChipText: { fontSize: 12, color: '#333', fontWeight: '600' },
  actionRow: { flexDirection: 'row', marginTop: 16 },
  joinButton: {
    backgroundColor: '#3182F6',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  joinButtonText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  cancelJoinButton: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginLeft: 8,
    borderRadius: 14,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E5E8EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelJoinText: { color: '#888', fontWeight: '700', fontSize: 13 },
  cancelJoinButtonFull: {
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E5E8EB',
    alignItems: 'center',
    marginTop: 8,
  },
  enrouteButton: {
    backgroundColor: '#22C55E',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  enrouteButtonText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  statusStepRow: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 6,
  },
  statusStepDone: {
    flex: 1,
    backgroundColor: '#E8F5E9',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  statusStepDoneText: { fontSize: 11, color: '#22C55E', fontWeight: '800' },
  statusStepPending: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  statusStepPendingText: { fontSize: 11, color: '#999', fontWeight: '700' },
  arrivalPreview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginTop: 8,
    backgroundColor: '#EEE',
  },
  closeEarlyBtn: {
    backgroundColor: '#FFF8E1',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  closeEarlyBtnText: { color: '#92400E', fontWeight: '800', fontSize: 13 },
  commentItem: { marginBottom: 12 },
  commentReactions: { flexDirection: 'row', marginTop: 4, marginLeft: 4 },
  commentReactBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#EEE',
    marginRight: 6,
  },
  commentReactBtnLikeOn: { backgroundColor: '#3182F6', borderColor: '#3182F6' },
  commentReactBtnDislikeOn: { backgroundColor: '#FF5C5C', borderColor: '#FF5C5C' },
  commentReactText: { fontSize: 11, color: '#666', fontWeight: '700' },
  dailyQuotaBox: {
    backgroundColor: '#F0F4FF',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  dailyQuotaText: { fontSize: 12, color: '#3182F6', fontWeight: '800' },
  dailyQuotaBarBg: {
    height: 5,
    backgroundColor: '#FFF',
    borderRadius: 3,
    marginTop: 6,
    overflow: 'hidden',
  },
  dailyQuotaBarFill: { height: '100%', borderRadius: 3 },
  joinReqBox: {
    backgroundColor: '#FFFCF0',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  joinReqLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
    marginBottom: 10,
  },
  joinReqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
  },
  joinReqName: { fontSize: 13, fontWeight: '700', color: '#191F28' },
  joinReqMeta: { fontSize: 10, color: '#888', marginTop: 2 },
  joinReqAcceptBtn: {
    backgroundColor: '#22C55E',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 4,
  },
  joinReqAcceptText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  joinReqRejectBtn: {
    backgroundColor: '#FFE5E5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  joinReqRejectText: { color: '#FF5C5C', fontSize: 11, fontWeight: '800' },
  farRequestBox: {
    backgroundColor: '#FFF8E1',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  farRequestText: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  acceptedMessageBox: {
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  acceptedMessageText: { fontSize: 12, color: '#16A34A', fontWeight: '700' },
  timePickerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    paddingRight: 8,
    marginBottom: 8,
  },
  timePickerClear: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  timeQuickChips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  timeQuickChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#EEE',
    marginRight: 6,
    marginBottom: 6,
  },
  timeQuickChipOn: { backgroundColor: '#3182F6', borderColor: '#3182F6' },
  timeQuickChipText: { fontSize: 12, color: '#666' },
  timeDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F4FF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  timeDisplayText: { fontSize: 18, fontWeight: '900', color: '#3182F6' },
  timePickerSubLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 6,
  },
  timeChipScroll: { paddingVertical: 4, paddingRight: 8 },
  timeChip: {
    minWidth: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#EEE',
    marginRight: 6,
    marginBottom: 6,
    alignItems: 'center',
  },
  timeChipOn: { backgroundColor: '#3182F6', borderColor: '#3182F6' },
  timeChipText: { fontSize: 14, color: '#666', fontWeight: '700' },
  timeChipTextOn: { color: '#FFF', fontWeight: '800' },
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  wheelColonNew: { fontSize: 28, fontWeight: '900', color: '#3182F6', marginHorizontal: 4 },
  wheelMeta: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  wheelMetaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3182F6',
    marginBottom: 6,
  },
  wheelClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  sortScroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#EEE',
    marginRight: 8,
  },
  sortChipOn: { backgroundColor: '#3182F6', borderColor: '#3182F6' },
  sortChipFavOn: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' },
  sortChipText: { fontSize: 12, color: '#666', fontWeight: '700' },
  sortChipTextOn: { color: '#FFF', fontWeight: '800' },
  favStarBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  favStarBtnOn: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' },
  favStarText: { color: '#92400E', fontWeight: '800', fontSize: 13 },
  lockedNotice: {
    backgroundColor: '#FFF8E1',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  lockedNoticeText: { fontSize: 11, color: '#92400E', lineHeight: 16 },
  notifPermBtn: {
    backgroundColor: '#F0F4FF',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#3182F6',
  },
  notifPermText: { color: '#3182F6', fontSize: 12, fontWeight: '800' },
  uidBox: {
    backgroundColor: '#F8F9FA',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  uidLabel: { fontSize: 10, color: '#888', fontWeight: '700' },
  uidValue: { fontSize: 11, color: '#3182F6', fontFamily: 'monospace', marginTop: 2 },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  rankNum: {
    fontSize: 16,
    fontWeight: '900',
    color: '#191F28',
    marginRight: 12,
    minWidth: 24,
  },
  rankName: { fontSize: 13, fontWeight: '800', color: '#191F28' },
  rankMeta: { fontSize: 11, color: '#888', marginTop: 2 },
  rankScore: { fontSize: 12, fontWeight: '900', color: '#3182F6' },
  disabledJoinButton: {
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
  },
  disabledJoinText: { color: '#999', fontSize: 13, fontWeight: '700' },
  commentUserLink: { color: '#3182F6' },
  friendBadge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
  },
  friendBadgeText: { color: '#4CAF50', fontSize: 12, fontWeight: '800' },
  userActionRow: { flexDirection: 'row', marginTop: 24 },
  userActionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  userActionBtnPrimary: { backgroundColor: '#3182F6' },
  userActionBtnSecondary: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E5E8EB',
  },
  userActionBtnDanger: {
    backgroundColor: '#FFF0F0',
    borderWidth: 1,
    borderColor: '#FFD6D6',
  },
  userActionBtnDisabled: { backgroundColor: '#F0F0F0' },
  userActionBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  userActionBtnTextSecondary: { color: '#666' },
  userActionBtnTextDisabled: { color: '#AAA' },
  commentBox: {
    marginTop: 24,
    borderTopWidth: 1,
    borderColor: '#EEE',
    paddingTop: 16,
  },
  commentLine: { flexDirection: 'row', marginBottom: 8, paddingVertical: 4, flexWrap: 'wrap' },
  commentUser: { fontWeight: '700', fontSize: 13, color: '#191F28' },
  commentText: { fontSize: 13, color: '#333' },
  commentInputRow: { flexDirection: 'row', marginTop: 12 },
  commentInputField: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    fontSize: 13,
    marginRight: 8,
  },
  commentSendBtn: {
    backgroundColor: '#3182F6',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 12,
  },
  commentSendText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  noShowLink: { marginTop: 30, alignSelf: 'center' },
  noShowLinkText: { color: '#FF5C5C', fontSize: 12, textDecorationLine: 'underline' },
  deleteLink: { marginTop: 30, alignSelf: 'center' },
  deleteLinkText: { color: '#FF5C5C', fontSize: 13, textDecorationLine: 'underline' },
  reportUserItem: {
    padding: 15,
    backgroundColor: '#FFF0F0',
    borderRadius: 12,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportUserText: { fontSize: 14, fontWeight: '700' },
  chatListContainer: {},
  chatRoomItem: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  chatRoomImg: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 14,
    backgroundColor: '#F0F0F0',
  },
  chatRoomInfo: { flex: 1 },
  chatRoomTitle: { fontSize: 15, fontWeight: '800', marginBottom: 4, color: '#191F28' },
  chatRoomMsg: { fontSize: 12, color: '#888' },
  chatRoomMeta: { alignItems: 'flex-end' },
  chatRoomTime: { fontSize: 10, color: '#AAA', marginBottom: 6 },
  unreadBadge: {
    backgroundColor: '#FF5C5C',
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  usageBanner: {
    backgroundColor: '#F0F4FF',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  usageBannerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  usageBannerLabel: { fontSize: 13, fontWeight: '700', color: '#3182F6' },
  usageBannerValue: { fontSize: 13, fontWeight: '900', color: '#3182F6' },
  usageBarBg: {
    height: 6,
    backgroundColor: '#FFF',
    borderRadius: 3,
    marginTop: 8,
    overflow: 'hidden',
  },
  usageBarFill: { height: '100%', borderRadius: 3 },
  usageBannerHint: {
    fontSize: 11,
    color: '#666',
    marginTop: 8,
    lineHeight: 16,
  },
  lockText: {
    fontSize: 10,
    color: '#FF5C5C',
    fontWeight: '700',
    marginLeft: 6,
  },
  chatRoomQuota: { fontSize: 10, color: '#3182F6', marginTop: 2, fontWeight: '700' },
  chatStartBtn: {
    backgroundColor: '#3182F6',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  chatStartBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  chatQuotaBar: {
    backgroundColor: '#F0F4FF',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  chatQuotaText: { fontSize: 11, fontWeight: '700', color: '#3182F6' },
  chatInputDisabled: { backgroundColor: '#F0F0F0', color: '#AAA' },
  premiumTeaser: {
    backgroundColor: '#FFF8E1',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  premiumTeaserTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
    marginBottom: 4,
  },
  premiumTeaserDesc: { fontSize: 11, color: '#92400E' },
  friendName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#191F28',
    marginTop: 4,
    maxWidth: 56,
    textAlign: 'center',
  },
  cardImage: {
    width: '100%',
    height: 140,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#EEE',
  },
  cardTooFar: { opacity: 0.5 },
  cardDistance: { fontSize: 11, color: '#666', marginTop: 2, fontWeight: '700' },
  detailImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginTop: 16,
    backgroundColor: '#EEE',
  },
  detailMapWrapper: { marginTop: 16 },
  detailDistanceBar: {
    backgroundColor: '#F0F4FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginTop: -4,
  },
  detailDistanceText: { fontSize: 12, color: '#3182F6', fontWeight: '800' },
  mapHint: { fontSize: 11, color: '#888', marginVertical: 8, lineHeight: 16 },
  imagePickBtn: {
    backgroundColor: '#F0F4FF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3182F6',
    borderStyle: 'dashed',
  },
  imagePickText: { color: '#3182F6', fontWeight: '800', fontSize: 13 },
  previewImage: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    backgroundColor: '#EEE',
  },
  imageRemoveBtn: { alignSelf: 'flex-end', marginTop: 6 },
  imageRemoveText: { color: '#FF5C5C', fontSize: 12, fontWeight: '700' },
  heroMapBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    zIndex: 1,
  },
  heroMapBtnText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  settingsBox: { marginTop: 24, borderTopWidth: 1, borderColor: '#EEE', paddingTop: 16 },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingsLabel: { fontSize: 14, fontWeight: '700', color: '#191F28' },
  adminEntryBtn: {
    backgroundColor: '#FFF8E1',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  adminEntryText: { color: '#92400E', fontWeight: '800', fontSize: 13 },
  adminWarn: {
    backgroundColor: '#FFF8E1',
    padding: 12,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
    marginBottom: 12,
  },
  adminWarnText: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  adminStatsRow: { flexDirection: 'row', marginBottom: 8 },
  adminStatBox: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  adminStatNum: { fontSize: 20, fontWeight: '900', color: '#191F28' },
  adminStatLab: { fontSize: 11, color: '#888', marginTop: 4 },
  adminPostRow: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#EEE',
    padding: 12,
    borderRadius: 12,
    marginBottom: 6,
    alignItems: 'center',
  },
  adminPostTitle: { fontSize: 13, fontWeight: '700', color: '#191F28' },
  adminPostMeta: { fontSize: 11, color: '#888', marginTop: 2 },
  adminDeleteBtn: {
    backgroundColor: '#FFE5E5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  adminDeleteText: { color: '#FF5C5C', fontSize: 12, fontWeight: '800' },
  adminUserRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#EEE',
    padding: 12,
    borderRadius: 12,
    marginBottom: 6,
  },
  adminUserName: { fontSize: 13, fontWeight: '700', color: '#191F28' },
  adminUserMeta: { fontSize: 11, color: '#888' },
  bellBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
    position: 'relative',
  },
  bellIcon: { fontSize: 22 },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#FF5C5C',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellBadgeText: { color: '#FFF', fontSize: 9, fontWeight: '800' },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8, color: '#191F28' },
  searchClear: { fontSize: 16, color: '#AAA', paddingHorizontal: 6 },
  shareBtn: {
    backgroundColor: '#F0F4FF',
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
    alignItems: 'center',
  },
  shareBtnText: { color: '#3182F6', fontWeight: '800', fontSize: 14 },
  reportUserItemOn: { backgroundColor: '#FFE5E5', borderWidth: 1, borderColor: '#FF5C5C' },
  reportReasonItem: {
    padding: 14,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  reportReasonItemOn: { backgroundColor: '#FF5C5C', borderColor: '#FF5C5C' },
  reportReasonText: { fontSize: 13, color: '#333' },
  notifActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
    gap: 16,
  },
  notifActionText: { fontSize: 12, color: '#3182F6', fontWeight: '700' },
  notifItem: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EEE',
    alignItems: 'center',
  },
  notifItemUnread: { backgroundColor: '#F0F4FF', borderColor: '#3182F6' },
  notifTitle: { fontSize: 14, fontWeight: '800', color: '#191F28', marginBottom: 4 },
  notifBody: { fontSize: 12, color: '#666', marginBottom: 4 },
  notifTime: { fontSize: 10, color: '#AAA' },
  notifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF5C5C', marginLeft: 8 },
  levelBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  levelBadgeText: { fontSize: 11, fontWeight: '800' },
  sparkBreakdown: {
    fontSize: 11,
    color: '#888',
    marginTop: 10,
    lineHeight: 16,
  },
  onboardScroll: { padding: 24, paddingBottom: 40 },
  onboardHero: { alignItems: 'center', marginVertical: 30 },
  onboardEmoji: { fontSize: 56 },
  onboardLogo: {
    fontSize: 32,
    fontWeight: '900',
    color: '#3182F6',
    marginTop: 12,
  },
  onboardTagline: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  onboardTerms: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
    marginTop: 24,
  },
  onboardTermsText: { fontSize: 11, color: '#888', lineHeight: 18 },
  friendItem: { alignItems: 'center', marginRight: 14 },
  friendAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEE' },
  friendOnlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    backgroundColor: '#4CAF50',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  msgRow: { paddingHorizontal: 4, marginVertical: 4 },
  msgRowMe: { alignItems: 'flex-end' },
  msgRowThem: { alignItems: 'flex-start' },
  msgBubble: {
    maxWidth: '75%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  msgBubbleMe: { backgroundColor: '#3182F6', borderBottomRightRadius: 4 },
  msgBubbleThem: { backgroundColor: '#F0F2F5', borderBottomLeftRadius: 4 },
  msgText: { fontSize: 14, color: '#191F28' },
  chatInputRow: {
    flexDirection: 'row',
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: '#EEE',
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 22,
    fontSize: 14,
    marginRight: 8,
  },
  chatSendBtn: {
    backgroundColor: '#3182F6',
    paddingHorizontal: 18,
    borderRadius: 22,
    justifyContent: 'center',
  },
  chatSendText: { color: '#FFF', fontWeight: '800' },
});
