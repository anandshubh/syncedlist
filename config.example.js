// Copy to config.js and fill in with your NEW (multi-household) Firebase project.
// The Firebase apiKey is NOT secret — Firestore/Storage rules do the real security.
// There is no email allowlist anymore: access is controlled by the members/{uid} doc.
export const shoppingListConfig = {
  apiKey: "…",
  authDomain: "….firebaseapp.com",
  projectId: "…",
  storageBucket: "….firebasestorage.app",  // copy EXACTLY from the Firebase console
  messagingSenderId: "…",
  appId: "…",
};
export const WORKER_URL = "https://<your-new-worker>.workers.dev";
