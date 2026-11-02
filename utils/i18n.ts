import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'de';

const LANG_KEY = 'vn_creator_lang';

const dict = {
  en: {
    'app.name': 'VN Creator',
    'app.claim': 'Stories shape worlds',
    'app.footer': 'A greater story awaits',

    'nav.home': 'Home',
    'nav.world': 'World & Lore',
    'nav.chapters': 'Chapters',
    'nav.scenes': 'Scenes',
    'nav.chars': 'Characters',
    'nav.maps': 'Maps',
    'nav.dungeons': 'Dungeons',
    'nav.battles': 'Battles',
    'nav.assets': 'Assets',
    'nav.collapse': 'Collapse menu',
    'nav.expand': 'Expand menu',

    'home.untitled': 'Untitled Project',
    'home.begin': 'Begin Adventure',
    'home.continue': 'Continue',
    'home.settings': 'Settings',
    'home.details': 'Project Details',
    'home.emblem': 'Project Emblem',
    'home.field.title': 'Title',
    'home.field.tagline': 'Tagline',
    'home.field.genre': 'Genre',
    'home.field.tone': 'Tone',
    'home.field.length': 'Target Length',
    'home.field.image': 'Project Image',
    'home.field.edited': 'Last Edited',
    'home.placeholder.title': 'Name of your project',
    'home.placeholder.tagline': 'A line that sums up your story',
    'home.select': 'Choose…',
    'home.image.upload': 'Upload image',
    'home.image.change': 'Change image',
    'home.image.remove': 'Remove',
    'home.image.hint': 'Used as hero background, project card and emblem.',
    'home.emblem.prev': 'Previous project',
    'home.emblem.next': 'Next project',
    'home.seal': 'A world still unwritten',
    'home.footer': 'Ideas become journeys',
    'home.never': 'Never',

    'genre.fantasy': 'Fantasy',
    'genre.scifi': 'Sci-Fi',
    'genre.cyberpunk': 'Cyberpunk',
    'genre.horror': 'Horror',
    'genre.mystery': 'Mystery',
    'genre.romance': 'Romance',
    'genre.historical': 'Historical',
    'genre.adventure': 'Adventure',
    'genre.slice': 'Slice of Life',
    'genre.other': 'Other',
    'tone.dramatic': 'Dramatic',
    'tone.lighthearted': 'Lighthearted',
    'tone.dark': 'Dark',
    'tone.mysterious': 'Mysterious',
    'tone.romantic': 'Romantic',
    'tone.comedic': 'Comedic',
    'tone.epic': 'Epic',
    'tone.melancholic': 'Melancholic',
    'length.short': 'Short (1 – 10 hours)',
    'length.medium': 'Medium (10 – 30 hours)',
    'length.long': 'Long (30 – 60 hours)',
    'length.epic': 'Epic (60+ hours)',

    'settings.title': 'Settings',
    'settings.subtitle': 'Language, audio, save data, project files and AI models.',
    'settings.back': 'Back to Home',
    'settings.general': 'General',
    'settings.language': 'Language',
    'settings.language.hint': 'Language of the editor menus. Story content is never translated.',
    'settings.audio': 'Audio',
    'settings.music': 'Music Volume',
    'settings.sfx': 'SFX Volume',
    'settings.savegame': 'Save Data',
    'settings.savegame.hint': 'Save progress locally or export / import save files.',
    'settings.quicksave': 'Quick Save locally',
    'settings.quicksaved': 'Project saved locally!',
    'settings.exportsave': 'Export Save',
    'settings.importsave': 'Import Save',
    'settings.project': 'Project Data',
    'settings.project.hint': 'Export or import the whole project. "Full" packs every generated image, voice and music file into the ZIP.',
    'settings.exportfull': 'Export Full (incl. media)',
    'settings.exportlight': 'Export Light (data only)',
    'settings.import': 'Import Project (ZIP/JSON)',
  },
  de: {
    'app.name': 'VN Creator',
    'app.claim': 'Geschichten formen Welten',
    'app.footer': 'Eine größere Geschichte wartet',

    'nav.home': 'Start',
    'nav.world': 'Welt & Lore',
    'nav.chapters': 'Kapitel',
    'nav.scenes': 'Szenen',
    'nav.chars': 'Charaktere',
    'nav.maps': 'Karten',
    'nav.dungeons': 'Dungeons',
    'nav.battles': 'Kämpfe',
    'nav.assets': 'Assets',
    'nav.collapse': 'Menü einklappen',
    'nav.expand': 'Menü ausklappen',

    'home.untitled': 'Unbenanntes Projekt',
    'home.begin': 'Abenteuer beginnen',
    'home.continue': 'Fortsetzen',
    'home.settings': 'Einstellungen',
    'home.details': 'Projektdetails',
    'home.emblem': 'Projekt-Emblem',
    'home.field.title': 'Titel',
    'home.field.tagline': 'Leitsatz',
    'home.field.genre': 'Genre',
    'home.field.tone': 'Tonalität',
    'home.field.length': 'Zielumfang',
    'home.field.image': 'Projektbild',
    'home.field.edited': 'Zuletzt bearbeitet',
    'home.placeholder.title': 'Name deines Projekts',
    'home.placeholder.tagline': 'Ein Satz, der deine Geschichte beschreibt',
    'home.select': 'Auswählen…',
    'home.image.upload': 'Bild hochladen',
    'home.image.change': 'Bild ändern',
    'home.image.remove': 'Entfernen',
    'home.image.hint': 'Wird als Hintergrund, Projektkarte und Emblem verwendet.',
    'home.emblem.prev': 'Vorheriges Projekt',
    'home.emblem.next': 'Nächstes Projekt',
    'home.seal': 'Eine Welt, noch ungeschrieben',
    'home.footer': 'Ideen werden zu Reisen',
    'home.never': 'Nie',

    'genre.fantasy': 'Fantasy',
    'genre.scifi': 'Sci-Fi',
    'genre.cyberpunk': 'Cyberpunk',
    'genre.horror': 'Horror',
    'genre.mystery': 'Krimi / Mystery',
    'genre.romance': 'Romanze',
    'genre.historical': 'Historisch',
    'genre.adventure': 'Abenteuer',
    'genre.slice': 'Slice of Life',
    'genre.other': 'Sonstiges',
    'tone.dramatic': 'Dramatisch',
    'tone.lighthearted': 'Unbeschwert',
    'tone.dark': 'Düster',
    'tone.mysterious': 'Geheimnisvoll',
    'tone.romantic': 'Romantisch',
    'tone.comedic': 'Komisch',
    'tone.epic': 'Episch',
    'tone.melancholic': 'Melancholisch',
    'length.short': 'Kurz (1 – 10 Stunden)',
    'length.medium': 'Mittel (10 – 30 Stunden)',
    'length.long': 'Lang (30 – 60 Stunden)',
    'length.epic': 'Episch (60+ Stunden)',

    'settings.title': 'Einstellungen',
    'settings.subtitle': 'Sprache, Audio, Speicherdaten, Projektdateien und KI-Modelle.',
    'settings.back': 'Zurück zum Start',
    'settings.general': 'Allgemein',
    'settings.language': 'Sprache',
    'settings.language.hint': 'Sprache der Editor-Menüs. Story-Inhalte werden nie übersetzt.',
    'settings.audio': 'Audio',
    'settings.music': 'Musik-Lautstärke',
    'settings.sfx': 'SFX-Lautstärke',
    'settings.savegame': 'Speicherdaten',
    'settings.savegame.hint': 'Fortschritt lokal speichern oder Spielstände exportieren / importieren.',
    'settings.quicksave': 'Lokal schnellspeichern',
    'settings.quicksaved': 'Projekt lokal gespeichert!',
    'settings.exportsave': 'Spielstand exportieren',
    'settings.importsave': 'Spielstand importieren',
    'settings.project': 'Projektdaten',
    'settings.project.hint': 'Das gesamte Projekt exportieren oder importieren. „Full" packt alle generierten Bilder, Sprach- und Musikdateien mit in die ZIP.',
    'settings.exportfull': 'Export Full (inkl. Medien)',
    'settings.exportlight': 'Export Light (nur Daten)',
    'settings.import': 'Projekt importieren (ZIP/JSON)',
  }
} as const;

export type TKey = keyof typeof dict.en;

const readLang = (): Lang => {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'de' || v === 'en') return v;
  } catch { /* ignore */ }
  return 'en';
};

let current: Lang = readLang();
const listeners = new Set<() => void>();

export const getLang = () => current;

export const setLang = (lang: Lang) => {
  current = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  listeners.forEach(l => l());
};

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export const translate = (key: TKey, lang: Lang = current): string => dict[lang][key] ?? dict.en[key] ?? key;

/** React hook: returns t() bound to the current language and re-renders on change */
export const useI18n = () => {
  const lang = useSyncExternalStore(subscribe, getLang);
  return { lang, setLang, t: (key: TKey) => translate(key, lang) };
};
