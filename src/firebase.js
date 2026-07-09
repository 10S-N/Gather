import { initializeApp } from "firebase/app"
import { getFirestore } from "firebase/firestore"
import { getAuth } from "firebase/auth"
import { getStorage } from "firebase/storage"

const firebaseConfig = {
  apiKey: "AIzaSyAZG0vk0CX2yfkrV8ez_vNtF_Uihw3u8ng",
  authDomain: "austin-local-events.firebaseapp.com",
  projectId: "austin-local-events",
  storageBucket: "austin-local-events.firebasestorage.app",
  messagingSenderId: "239816728021",
  appId: "1:239816728021:web:9fe21c39a3910aba0cb15c"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
export const storage = getStorage(app)
