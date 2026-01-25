'use client';

import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, getFirestore } from 'firebase/firestore';
import { app } from '@/lib/firebase';
import Link from 'next/link';

const db = getFirestore(app);

interface RawNotification {
  id: string;
  packageName: string;
  title: string;
  text: string;
  bigText: string;
  fullText: string;
  date: string;
  time: string;
  createdAt: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<RawNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'rawNotifications'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as RawNotification[];
      setNotifications(data);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'rawNotifications', id));
  };

  const handleDeleteAll = async () => {
    if (!confirm('모든 알림을 삭제하시겠습니까?')) return;
    for (const notification of notifications) {
      await deleteDoc(doc(db, 'rawNotifications', notification.id));
    }
  };

  const getAppName = (packageName: string) => {
    switch (packageName) {
      case 'com.coupang.mobile.eats':
        return '쿠팡이츠';
      case 'com.coupang.mobile':
        return '쿠팡';
      default:
        return packageName;
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 bg-slate-100">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-4 mb-2">
            <Link
              href="/"
              className="text-slate-500 hover:text-slate-700 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-slate-800">
              수집된 알림
            </h1>
          </div>
          <p className="text-slate-500 text-sm">
            쿠팡이츠 등 배달앱 알림을 분석하기 위해 수집한 원본 데이터
          </p>
        </header>

        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">
              총 {notifications.length}개의 알림
            </span>
            {notifications.length > 0 && (
              <button
                onClick={handleDeleteAll}
                className="text-sm text-red-500 hover:text-red-600"
              >
                전체 삭제
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-slate-500">로딩 중...</div>
        ) : notifications.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <p className="text-slate-500 mb-2">수집된 알림이 없습니다</p>
            <p className="text-slate-400 text-sm">
              쿠팡이츠에서 주문하면 알림이 여기에 저장됩니다
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className="bg-white rounded-xl shadow-sm p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded mb-2">
                      {getAppName(notification.packageName)}
                    </span>
                    <div className="text-sm text-slate-500">
                      {notification.date} {notification.time}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(notification.id)}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-2">
                  {notification.title && (
                    <div>
                      <span className="text-xs text-slate-400 block">Title:</span>
                      <span className="text-slate-800">{notification.title}</span>
                    </div>
                  )}
                  {notification.text && (
                    <div>
                      <span className="text-xs text-slate-400 block">Text:</span>
                      <span className="text-slate-800">{notification.text}</span>
                    </div>
                  )}
                  {notification.bigText && notification.bigText !== notification.text && (
                    <div>
                      <span className="text-xs text-slate-400 block">BigText:</span>
                      <span className="text-slate-800 whitespace-pre-wrap">{notification.bigText}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100">
                  <span className="text-xs text-slate-400 block mb-1">Full Text:</span>
                  <pre className="text-xs bg-slate-50 p-2 rounded overflow-x-auto whitespace-pre-wrap text-slate-700">
                    {notification.fullText}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
