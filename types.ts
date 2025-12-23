
export interface Place {
  name: string;
  description: string;
  location: string;
  imageUrl: string;
  mapLink: string;
  rating?: number;
  imgTag?: string;
}

export interface TranslationResult {
  translatedText: string;
  originalText: string;
  fromLang: string;
  toLang: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export enum AppTab {
  EXPLORE = 'explore',
  TRANSLATE = 'translate',
  AI_GUIDE = 'guide',
  SETTINGS = 'settings'
}

export interface AppSettings {
  preferredLanguage: string;
  isPremium: boolean;
  hasOnboarded: boolean;
  theme: 'light' | 'dark';
}

export const LANGUAGES = [
  { code: 'uz', name: 'O\'zbekcha' },
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'jp', name: '日本語' },
  { code: 'cn', name: '中文' },
  { code: 'kr', name: '한국어' },
  { code: 'kz', name: 'Қазақша' },
  { code: 'tj', name: 'Toҷикӣ' },
  { code: 'kg', name: 'Кыргызcha' }
];
