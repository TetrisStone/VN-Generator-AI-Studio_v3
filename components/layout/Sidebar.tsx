import React from 'react';
import { House, BookOpen, ScrollText, Feather, Users, Compass, Castle, Swords, Archive, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { EditorTab } from '../../types';
import { useI18n, TKey } from '../../utils/i18n';

const NAV: { id: EditorTab; label: TKey; icon: React.ReactNode }[] = [
  { id: 'home', label: 'nav.home', icon: <House size={20} /> },
  { id: 'world', label: 'nav.world', icon: <BookOpen size={20} /> },
  { id: 'chapters', label: 'nav.chapters', icon: <ScrollText size={20} /> },
  { id: 'scenes', label: 'nav.scenes', icon: <Feather size={20} /> },
  { id: 'chars', label: 'nav.chars', icon: <Users size={20} /> },
  { id: 'maps', label: 'nav.maps', icon: <Compass size={20} /> },
  { id: 'dungeons', label: 'nav.dungeons', icon: <Castle size={20} /> },
  { id: 'battles', label: 'nav.battles', icon: <Swords size={20} /> },
  { id: 'assets', label: 'nav.assets', icon: <Archive size={20} /> },
];

/** Book + star + laurel crest */
const Crest: React.FC<{ size?: number }> = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="#c9a45c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {/* star */}
    <path d="M32 3 L33.8 9 L40 10.5 L33.8 12 L32 18 L30.2 12 L24 10.5 L30.2 9 Z" fill="#e8cc87" stroke="none" />
    {/* book */}
    <path d="M32 24 C26 21 18 21 12 23 V42 C18 40 26 40 32 43 C38 40 46 40 52 42 V23 C46 21 38 21 32 24 Z" fill="#0c152a" />
    <path d="M32 24 V43" />
    <path d="M17 28 C21 27 25 27.5 28 29 M17 33 C21 32 25 32.5 28 34 M36 29 C39 27.5 43 27 47 28 M36 34 C39 32.5 43 32 47 33" strokeWidth="1" opacity=".7" />
    {/* laurel */}
    <path d="M10 48 C6 42 5 34 8 27" /><path d="M54 48 C58 42 59 34 56 27" />
    <path d="M8 31 C5 31 4 29 4 27 C7 27 8 29 8 31 Z M7 38 C4 38 3 36 3 34 C6 34 7 36 7 38 Z M10 44 C7 45 5 43 5 41 C8 41 10 42 10 44 Z" fill="#c9a45c" stroke="none" opacity=".8" />
    <path d="M56 31 C59 31 60 29 60 27 C57 27 56 29 56 31 Z M57 38 C60 38 61 36 61 34 C58 34 57 36 57 38 Z M54 44 C57 45 59 43 59 41 C56 41 54 42 54 44 Z" fill="#c9a45c" stroke="none" opacity=".8" />
    <path d="M22 52 C28 55 36 55 42 52" />
  </svg>
);

interface SidebarProps {
  tab: EditorTab;
  isOpen: boolean;
  onSelect: (tab: EditorTab) => void;
  onToggle: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ tab, isOpen, onSelect, onToggle }) => {
  const { t } = useI18n();
  return (
    <div className={`${isOpen ? 'w-64' : 'w-0 md:w-[72px]'} vn-sidebar transition-all duration-300 ease-in-out flex flex-col flex-shrink-0 z-40 relative md:static absolute inset-y-0 left-0 overflow-hidden`}>
      {/* Brand */}
      <div className={`relative pt-5 pb-4 flex flex-col items-center whitespace-nowrap ${isOpen ? 'min-w-[16rem]' : 'min-w-0'}`}>
        {isOpen ? (
          <>
            <div className="absolute top-2 right-2 flex">
              <button className="hidden md:flex text-gray-400 hover:text-emerald-300 p-1 rounded transition-colors" onClick={() => onToggle(false)} title={t('nav.collapse')}>
                <ChevronLeft size={18} />
              </button>
              <button className="md:hidden text-gray-400" onClick={() => onToggle(false)}><XCircle size={20} /></button>
            </div>
            <Crest />
            <div className="vn-font-display text-[1.35rem] tracking-[0.12em] text-emerald-300 mt-1 uppercase">{t('app.name')}</div>
            <div className="vn-font-display text-[0.55rem] tracking-[0.3em] text-gray-400 uppercase mt-0.5">{t('app.claim')}</div>
          </>
        ) : (
          <button className="hidden md:flex flex-col items-center gap-1 text-gray-400 hover:text-emerald-300" onClick={() => onToggle(true)} title={t('nav.expand')}>
            <Crest size={38} />
            <ChevronRight size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto py-1 space-y-0.5 ${isOpen ? 'min-w-[16rem] px-2' : 'min-w-0 px-1'}`}>
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            title={t(item.label)}
            className={`vn-nav-item ${tab === item.id ? 'active' : ''} ${isOpen ? '' : 'collapsed'}`}
          >
            <span className="vn-nav-icon">{item.icon}</span>
            {isOpen && <span className="truncate">{t(item.label)}</span>}
          </button>
        ))}
      </nav>

      {/* Footer */}
      {isOpen && (
        <div className="min-w-[16rem] pb-4 pt-3 px-6 text-center">
          <div className="flex items-center gap-2 mb-2">
            <hr className="vn-rule flex-1" /><span className="block w-1.5 h-1.5 rotate-45" style={{ background: 'var(--vn-gold)' }} /><hr className="vn-rule flex-1" />
          </div>
          <div className="vn-font-display text-[0.55rem] tracking-[0.3em] text-gray-400 uppercase">{t('app.footer')}</div>
        </div>
      )}
    </div>
  );
};
