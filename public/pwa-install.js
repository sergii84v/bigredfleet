// PWA Installation Helper
let deferredPrompt;
let installButton = null;

// Слушаем событие beforeinstallprompt
window.addEventListener('beforeinstallprompt', (e) => {
  console.log('[PWA] Install prompt available');
  // Предотвращаем автоматический показ
  e.preventDefault();
  // Сохраняем событие для использования позже
  deferredPrompt = e;
  // Показываем кнопку установки
  showInstallButton();
});

// Слушаем событие установки приложения
window.addEventListener('appinstalled', () => {
  console.log('[PWA] App installed successfully');
  hideInstallButton();
  deferredPrompt = null;
});

function showInstallButton() {
  // Создаем кнопку установки, если её нет
  if (!installButton) {
    installButton = document.createElement('button');
    installButton.innerHTML = '📱 Установить приложение';
    installButton.className = 'fixed bottom-4 right-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-colors z-50';
    installButton.onclick = installApp;
    document.body.appendChild(installButton);
  }
  installButton.style.display = 'block';
}

function hideInstallButton() {
  if (installButton) {
    installButton.style.display = 'none';
  }
}

async function installApp() {
  if (!deferredPrompt) {
    console.log('[PWA] No install prompt available');
    return;
  }

  // Показываем диалог установки
  deferredPrompt.prompt();
  
  // Ждем выбора пользователя
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`[PWA] User choice: ${outcome}`);
  
  // Сбрасываем deferredPrompt
  deferredPrompt = null;
  hideInstallButton();
}

// Проверяем, запущено ли приложение как PWA
function isPWA() {
  return window.matchMedia('(display-mode: standalone)').matches || 
         window.navigator.standalone || 
         document.referrer.includes('android-app://');
}

// Если уже установлено как PWA, не показываем кнопку
if (isPWA()) {
  console.log('[PWA] Running as installed app');
} else {
  console.log('[PWA] Running in browser');
}
