import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported, logEvent } from 'firebase/analytics';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithPopup,
  signInWithCredential,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAB2ZRDAjKQfGeZvSYAvt_KlZ7LdMJO-ME',
  authDomain: 'nowhere-app-c2c34.firebaseapp.com',
  projectId: 'nowhere-app-c2c34',
  storageBucket: 'nowhere-app-c2c34.firebasestorage.app',
  messagingSenderId: '588412058250',
  appId: '1:588412058250:web:a80543637f844b8ea54b73',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

let analytics = null;
isSupported()
  .then((ok) => {
    if (ok) analytics = getAnalytics(app);
  })
  .catch(() => {});

export const trackEvent = (name, params) => {
  try {
    if (analytics) logEvent(analytics, name, params || {});
  } catch (e) {}
};

export const ensureAnonymousAuth = () =>
  new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve(user);
      } else {
        signInAnonymously(auth).catch(reject);
      }
    });
  });

export const subscribeToAuth = (onChange) => {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      onChange(user);
    } else {
      signInAnonymously(auth).catch(() => {});
    }
  });
};

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  const currentUser = auth.currentUser;
  try {
    if (currentUser && currentUser.isAnonymous) {
      const result = await linkWithPopup(currentUser, provider);
      return result.user;
    } else {
      const result = await signInWithPopup(auth, provider);
      return result.user;
    }
  } catch (e) {
    if (e.code === 'auth/credential-already-in-use') {
      const credential = GoogleAuthProvider.credentialFromError(e);
      if (credential) {
        const result = await signInWithCredential(auth, credential);
        return result.user;
      }
    }
    throw e;
  }
};

export const signOutAndAnon = async () => {
  await signOut(auth);
  const result = await signInAnonymously(auth);
  return result.user;
};

export const isGoogleUser = (user) =>
  user && user.providerData.some((p) => p.providerId === 'google.com');

export const subscribeToPosts = (onUpdate) =>
  onSnapshot(collection(db, 'posts'), (snap) => {
    const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onUpdate(posts);
  });

export const subscribeToProfile = (uid, onUpdate) =>
  onSnapshot(doc(db, 'users', uid), (snap) => {
    if (snap.exists()) onUpdate({ uid, ...snap.data() });
    else onUpdate(null);
  });

export const upsertPost = async (post) => {
  await setDoc(doc(db, 'posts', post.id), post, { merge: false });
};

export const deletePostFs = async (postId) => {
  await deleteDoc(doc(db, 'posts', postId));
};

export const upsertProfile = async (profile) => {
  if (!profile.uid) return;
  await setDoc(doc(db, 'users', profile.uid), profile, { merge: false });
};

export const seedIfEmpty = async (seedPosts) => {
  const snap = await getDocs(collection(db, 'posts'));
  if (snap.empty) {
    await Promise.all(seedPosts.map((p) => upsertPost(p)));
  }
};

export const isNicknameTaken = async (nickname, excludeUid) => {
  const q = query(collection(db, 'users'), where('nickname', '==', nickname));
  const snap = await getDocs(q);
  return snap.docs.some((d) => d.id !== excludeUid);
};

export const deleteOldPosts = async (cutoffMs) => {
  const snap = await getDocs(collection(db, 'posts'));
  const oldDocs = snap.docs.filter((d) => {
    const data = d.data();
    return data.deadlineMs && data.deadlineMs < cutoffMs;
  });
  await Promise.all(oldDocs.map((d) => deleteDoc(d.ref)));
  return oldDocs.length;
};

export const subscribeToIsAdmin = (uid, onUpdate) =>
  onSnapshot(doc(db, 'admins', uid), (snap) => {
    onUpdate(snap.exists());
  });

export const submitReportFs = async (report) => {
  const id = `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await setDoc(doc(db, 'reports', id), { ...report, ts: Date.now() });
};

export const subscribeToReportsAgainst = (nickname, onUpdate) =>
  onSnapshot(
    query(collection(db, 'reports'), where('target', '==', nickname)),
    (snap) => {
      const reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onUpdate(reports);
    },
  );

export const subscribeToAnnouncements = (onUpdate) =>
  onSnapshot(collection(db, 'announcements'), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onUpdate(list.sort((a, b) => (b.ts || 0) - (a.ts || 0)));
  });

export const postAnnouncement = async (title, body) => {
  const id = `a-${Date.now()}`;
  await setDoc(doc(db, 'announcements', id), {
    title,
    body,
    ts: Date.now(),
  });
};

export const subscribeToAllReports = (onUpdate) =>
  onSnapshot(collection(db, 'reports'), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onUpdate(list.sort((a, b) => (b.ts || 0) - (a.ts || 0)));
  });

export const updateReportStatus = async (reportId, status, resolution) => {
  await setDoc(
    doc(db, 'reports', reportId),
    { status, resolution: resolution || '', resolvedAt: Date.now() },
    { merge: true },
  );
};

export const deleteUserDoc = async (uid) => {
  await deleteDoc(doc(db, 'users', uid));
};

export const deleteAllPosts = async () => {
  const snap = await getDocs(collection(db, 'posts'));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  return snap.docs.length;
};

export const deleteAllUsersExcept = async (keepUid) => {
  const snap = await getDocs(collection(db, 'users'));
  const toDelete = snap.docs.filter((d) => d.id !== keepUid);
  await Promise.all(toDelete.map((d) => deleteDoc(d.ref)));
  return toDelete.length;
};

export const deleteAllReports = async () => {
  const snap = await getDocs(collection(db, 'reports'));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  return snap.docs.length;
};

export const searchUsersByNickname = async (queryText) => {
  if (!queryText || queryText.length < 1) return [];
  const snap = await getDocs(collection(db, 'users'));
  const lower = queryText.toLowerCase();
  return snap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((u) => (u.nickname || '').toLowerCase().includes(lower));
};

export { serverTimestamp };
