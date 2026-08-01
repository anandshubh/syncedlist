// ---- EDIT THIS FILE with your own values, then redeploy. ----
//
// 1) Firebase console -> Project settings -> "Your apps" -> Web app -> SDK setup
//    Copy the config object and paste it below (replace the placeholders).
// 2) Put the two Google account emails that are allowed to use the ledger.
//    These must ALSO match the emails in firestore.rules and storage.rules.

export const shoppingListConfig = {
    apiKey: "AIzaSyAlAdMeckrGdS4FdqhvJe8qaYQwzE0r3ic",
  authDomain: "synclist-2adba.firebaseapp.com",
  projectId: "synclist-2adba",
  storageBucket: "synclist-2adba.firebasestorage.app",
  messagingSenderId: "90427614652",
  appId: "1:90427614652:web:3a5143d2f2fc2ec70637b9"

  };

// The only two accounts allowed to sign in. Lowercase.
export const ALLOWED_EMAILS = [
  "shubhamsaxena1492@gmail.com", "shubhangi9237@gmail.com"
];

// Your existing Cloudflare Worker (receipt vision). Leave "" to enter fields by hand.
export const WORKER_URL = "https://synclist.shubhamsaxena1492.workers.dev/";
