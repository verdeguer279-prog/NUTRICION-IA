import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, deleteDoc, writeBatch, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Tu configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDmiDfja_EDSK31fjxBmMxumWvYryYurHU",
    authDomain: "nutricion-f6e70.firebaseapp.com",
    projectId: "nutricion-f6e70",
    storageBucket: "nutricion-f6e70.firebasestorage.app",
    messagingSenderId: "926932712073",
    appId: "1:926932712073:web:d660418820d91ec4ec6458",
    measurementId: "G-MFB78MVX9S"
};

// Inicialización
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Exportamos las herramientas para usarlas en otros archivos
const fire = { doc, setDoc, getDoc, collection, getDocs, updateDoc, deleteDoc, writeBatch, query, where, orderBy, limit };

export { db, fire };