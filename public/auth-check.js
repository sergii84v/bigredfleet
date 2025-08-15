// Универсальная проверка аутентификации для PWA
import { supabase } from './supabase.js';

/**
 * Проверяет, залогинен ли пользователь и восстанавливает сессию если нужно
 * @param {string} requiredRole - 'mechanic' или 'guide'
 * @param {string} loginUrl - URL страницы входа для редиректа
 * @returns {Promise<{user: object, isAuthenticated: boolean}>}
 */
export async function checkAuth(requiredRole, loginUrl) {
  try {
    console.log('[Auth] Checking authentication...');
    
    // Пытаемся получить текущую сессию
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.warn('[Auth] Session error:', sessionError);
    }
    
    if (session?.user) {
      console.log('[Auth] Valid session found:', session.user.email);
      
          // Проверяем, что пользователь имеет правильную роль
    const email = session.user.email || '';
    let expectedDomain;
    
    if (requiredRole === 'admin') {
      expectedDomain = '@admin.local';
    } else {
      expectedDomain = `@${requiredRole}s.local`;
    }
    
    if (email.endsWith(expectedDomain)) {
        // Восстанавливаем данные пользователя в localStorage если их нет
        if (!localStorage.getItem('role')) {
          localStorage.setItem('role', requiredRole);
        }
        
        if (!localStorage.getItem('userSlug')) {
          const slug = email.replace(expectedDomain, '');
          localStorage.setItem('userSlug', slug);
        }
        
        return {
          user: session.user,
          isAuthenticated: true
        };
      } else {
        console.log('[Auth] Wrong role for user:', email);
        // Неправильная роль - выходим и редиректим
        await supabase.auth.signOut();
        localStorage.clear();
      }
    } else {
      console.log('[Auth] No valid session found');
    }
    
    // Если нет сессии или неправильная роль - редиректим на логин
    console.log('[Auth] Redirecting to login:', loginUrl);
    window.location.href = loginUrl;
    
    return {
      user: null,
      isAuthenticated: false
    };
    
  } catch (error) {
    console.error('[Auth] Authentication check failed:', error);
    window.location.href = loginUrl;
    
    return {
      user: null,
      isAuthenticated: false
    };
  }
}

/**
 * Настройка слушателя изменений аутентификации
 * @param {function} onAuthChange - колбэк при изменении состояния аутентификации
 */
export function setupAuthListener(onAuthChange) {
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('[Auth] Auth state changed:', event, session?.user?.email);
    
    if (event === 'SIGNED_OUT' || !session) {
      // Очищаем localStorage при выходе
      localStorage.removeItem('role');
      localStorage.removeItem('userSlug');
      localStorage.removeItem('userName');
      console.log('[Auth] Cleared localStorage on sign out');
    }
    
    if (onAuthChange) {
      onAuthChange(event, session);
    }
  });
}

/**
 * Безопасный выход из системы
 */
export async function signOut() {
  try {
    console.log('[Auth] Signing out...');
    await supabase.auth.signOut();
    localStorage.clear();
    window.location.href = '/';
  } catch (error) {
    console.error('[Auth] Sign out error:', error);
    // В любом случае очищаем localStorage и редиректим
    localStorage.clear();
    window.location.href = '/';
  }
}
