import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyBClHt50GMa3NIt3zHp98BftULsYnUTZK8",
  authDomain: "qlgd-tkb.firebaseapp.com",
  projectId: "qlgd-tkb",
  storageBucket: "qlgd-tkb.firebasestorage.app",
  messagingSenderId: "808818323887",
  appId: "1:808818323887:web:38df4209a59bc0aed1bf5a"
};

// Initialize Firebase
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Connectivity validation helper
export async function validateFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'schools', '_connectivity_ping_'));
    return true;
  } catch (error: any) {
    if (error?.message && error.message.includes('the client is offline')) {
      console.warn("Firestore client is offline or cannot reach network.");
      return false;
    }
    // If permission or missing doc error, it still means server was reached
    return true;
  }
}
