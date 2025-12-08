import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { provideFirebaseApp } from '@angular/fire/app';

import { provideAuth } from '@angular/fire/auth';
import { browserSessionPersistence, getAuth, initializeAuth } from 'firebase/auth';

import { provideFirestore } from '@angular/fire/firestore';
import { initializeFirestore } from 'firebase/firestore'; // ← v10 でOK
import { getStorage, provideStorage } from '@angular/fire/storage';

//  Web アプリ設定をそのままコピペ
const firebaseConfig = {
  apiKey: 'AIzaSyAks1R4s_hy_t5NvJXU9HFtMlIXSxksZZM',
  authDomain: 'kensyu10115.firebaseapp.com',
  projectId: 'kensyu10115',
  storageBucket: 'kensyu10115.firebasestorage.app',
  messagingSenderId: '412477725597',
  appId: '1:412477725597:web:90766942d4dc9446f52d74',
  measurementId: 'G-5S4Z76V2KN',
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withInMemoryScrolling({
      scrollPositionRestoration: 'top',
    })),

    // initializeApp は 1回だけ
    provideFirebaseApp(() =>
      getApps().length ? getApp() : initializeApp(firebaseConfig),
    ),

    // WebChannel 相性対策：長輪講を自動検出
    provideFirestore(() =>
      initializeFirestore(getApp(), {
        experimentalAutoDetectLongPolling: true,
      }),
    ),

    // セッション単位（タブ単位）で認証状態を分離する
    provideAuth(() => {
      const app = getApp();
      try {
        return initializeAuth(app, { persistence: browserSessionPersistence });
      } catch {
        // 既に初期化済みの場合は既存インスタンスを利用
        return getAuth(app);
      }
    }),
    // Storage をアプリ全体で利用できるように設定
    provideStorage(() => getStorage()),
  ],
};