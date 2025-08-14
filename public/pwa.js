// PWA Service Worker Registration
class PWAManager {
  constructor() {
    this.deferredPrompt = null;
    this.installButton = null;
    this.init();
  }

  init() {
    console.log('PWA Manager initializing...');
    
    // Service Worker регистрируется в HTML файлах
    console.log('PWA Manager initialized - SW registration handled in HTML');

    // Слушаем событие beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('beforeinstallprompt event fired!');
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallPromotion();
    });

    // Слушаем событие appinstalled
    window.addEventListener('appinstalled', () => {
      console.log('PWA was installed');
      this.hideInstallPromotion();
      this.deferredPrompt = null;
    });

    // Проверяем, установлено ли уже приложение
    if (window.matchMedia('(display-mode: standalone)').matches) {
      console.log('App is running in standalone mode');
    }
    
    // Для тестирования: показываем кнопку установки через 3 секунды
    setTimeout(() => {
      console.log('Showing install button for testing...');
      this.showInstallPromotion();
    }, 3000);
    
    // Проверяем PWA критерии
    this.checkPWACriteria();
  }

  showInstallPromotion() {
    // Создаем кнопку установки, если её нет
    if (!this.installButton) {
      this.installButton = document.createElement('div');
      this.installButton.id = 'pwa-install-button';
      this.installButton.innerHTML = `
        <div style="
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #dc2626;
          color: white;
          padding: 12px 20px;
          border-radius: 25px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          cursor: pointer;
          z-index: 10000;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 14px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M8 0a8 8 0 0 1 8 8 8 8 0 0 1-8 8A8 8 0 0 1 0 8a8 8 0 0 1 8-8zM4.5 7.5a.5.5 0 0 0 0 1h5.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5H4.5z"/>
          </svg>
          Install App
        </div>
      `;
      
      this.installButton.addEventListener('click', () => {
        this.installApp();
      });
      
      document.body.appendChild(this.installButton);
    }
  }

  hideInstallPromotion() {
    if (this.installButton) {
      this.installButton.remove();
      this.installButton = null;
    }
  }

  async installApp() {
    if (!this.deferredPrompt) {
      return;
    }

    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
    } else {
      console.log('User dismissed the install prompt');
    }
    
    this.deferredPrompt = null;
    this.hideInstallPromotion();
  }

  // Проверка PWA критериев
  checkPWACriteria() {
    console.log('Checking PWA criteria...');
    
    // Проверяем наличие manifest
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      console.log('✅ Manifest found:', manifestLink.href);
    } else {
      console.log('❌ Manifest not found');
    }
    
    // Проверяем наличие иконок
    const iconLinks = document.querySelectorAll('link[rel*="icon"]');
    console.log(`✅ Found ${iconLinks.length} icon links:`, Array.from(iconLinks).map(l => l.href));
    
    // Проверяем Service Worker
    if ('serviceWorker' in navigator) {
      console.log('✅ Service Worker supported');
    } else {
      console.log('❌ Service Worker not supported');
    }
    
    // Проверяем HTTPS (для production)
    if (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      console.log('✅ HTTPS/localhost - OK for PWA');
    } else {
      console.log('❌ HTTPS required for PWA in production');
    }
  }

  // Проверка онлайн/офлайн статуса
  checkOnlineStatus() {
    if (!navigator.onLine) {
      this.showOfflineMessage();
    } else {
      this.hideOfflineMessage();
    }
  }

  showOfflineMessage() {
    let offlineMsg = document.getElementById('offline-message');
    if (!offlineMsg) {
      offlineMsg = document.createElement('div');
      offlineMsg.id = 'offline-message';
      offlineMsg.innerHTML = `
        <div style="
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: #fbbf24;
          color: #92400e;
          text-align: center;
          padding: 8px;
          font-size: 14px;
          z-index: 10001;
          font-family: system-ui, -apple-system, sans-serif;
        ">
          ⚠️ You are currently offline. Some features may not work.
        </div>
      `;
      document.body.appendChild(offlineMsg);
    }
  }

  hideOfflineMessage() {
    const offlineMsg = document.getElementById('offline-message');
    if (offlineMsg) {
      offlineMsg.remove();
    }
  }
}

// Инициализация PWA при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  window.pwaManager = new PWAManager();
  
  // Слушаем изменения онлайн статуса
  window.addEventListener('online', () => {
    window.pwaManager.checkOnlineStatus();
  });
  
  window.addEventListener('offline', () => {
    window.pwaManager.checkOnlineStatus();
  });
  
  // Проверяем текущий статус
  window.pwaManager.checkOnlineStatus();
});

// Экспортируем для использования в других скриптах
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PWAManager;
}
