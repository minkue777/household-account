// 잔액 초기값 설정 스크립트
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, Timestamp } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyCyjcqLX9Gs-yIghFsq9v-vC6K91ZhMuYM",
  authDomain: "household-account-6f300.firebaseapp.com",
  projectId: "household-account-6f300",
  storageBucket: "household-account-6f300.firebasestorage.app",
  messagingSenderId: "530451947649",
  appId: "1:530451947649:web:b5630cc4326eaddbbfad80",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function setBalance() {
  const balancesRef = collection(db, 'balances');

  await addDoc(balancesRef, {
    householdId: 'ooZmqdvKQTkyvEPMERgs',
    type: 'localCurrency',
    balance: 784694,
    currencyType: '경기지역화폐',
    updatedAt: Timestamp.now()
  });

  console.log('잔액 설정 완료: 784,694원');
}

setBalance().catch(console.error);
