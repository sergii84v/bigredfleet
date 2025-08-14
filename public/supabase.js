import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Конфигурация Supabase для BigRed Workshop
const SUPABASE_URL = "https://dypzcfufoieaxauqqdvp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5cHpjZnVmb2llYXhhdXFxZHZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2NDI5NjgsImV4cCI6MjA3MDIxODk2OH0.FjZy8vQXFqL3gRTIeeJgTTqvJUopo7VX9tueT1b8enU";

// Настройки для длительного хранения сессии
const supabaseOptions = {
  auth: {
    // Автоматическое обновление токена
    autoRefreshToken: true,
    // Сохранять сессию в localStorage (по умолчанию)
    persistSession: true,
    // Обнаружение сессии при загрузке страницы
    detectSessionInUrl: false,
    // Время жизни сессии (по умолчанию 1 час, но будет автообновляться)
    // flowType: 'implicit'
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, supabaseOptions);

// (опционально) для отладки
console.log("Supabase client initialized with persistent session");
