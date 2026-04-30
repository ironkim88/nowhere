import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
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

export { serverTimestamp };
