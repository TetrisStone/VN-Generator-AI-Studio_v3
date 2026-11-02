import React, { useRef } from 'react';
import { Play, BookOpen, Settings as SettingsIcon, Castle, ChevronLeft, ChevronRight, ImagePlus, Trash2, ChevronDown, Feather } from 'lucide-react';
import { ProjectMeta } from '../types';
import { useI18n, TKey } from '../utils/i18n';
import { saveImage, deleteImage } from '../utils/imageStorage';
import { useStoredImage } from './ui/useStoredImage';
import { OrnateFrame, FantasyButton } from './ui/Ornate';

export interface ProjectSummary {
  id: string;
  title: string;
  coverImageId?: string | null;
}

interface HomeViewProps {
  meta: ProjectMeta;
  onUpdateMeta: (meta: ProjectMeta) => void;
  hasSaveGame: boolean;
  onPlay: () => void;
  onContinue: () => void;
  onOpenSettings: () => void;
  /** All projects (for the emblem switcher). Defaults to just the open one. */
  projects?: ProjectSummary[];
  activeProjectId?: string;
  onSelectProject?: (id: string) => void;
}

const GENRES: [string, TKey][] = [
  ['fantasy', 'genre.fantasy'], ['scifi', 'genre.scifi'], ['cyberpunk', 'genre.cyberpunk'], ['horror', 'genre.horror'],
  ['mystery', 'genre.mystery'], ['romance', 'genre.romance'], ['historical', 'genre.historical'],
  ['adventure', 'genre.adventure'], ['slice', 'genre.slice'], ['other', 'genre.other'],
];
const TONES: [string, TKey][] = [
  ['dramatic', 'tone.dramatic'], ['lighthearted', 'tone.lighthearted'], ['dark', 'tone.dark'], ['mysterious', 'tone.mysterious'],
  ['romantic', 'tone.romantic'], ['comedic', 'tone.comedic'], ['epic', 'tone.epic'], ['melancholic', 'tone.melancholic'],
];
const LENGTHS: [string, TKey][] = [
  ['short', 'length.short'], ['medium', 'length.medium'], ['long', 'length.long'], ['epic', 'length.epic'],
];

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[130px_1fr] items-center gap-3">
    <span className="vn-label">{label}</span>
    {children}
  </div>
);

const SelectField: React.FC<{ value?: string; options: [string, TKey][]; onChange: (v: string) => void }> = ({ value, options, onChange }) => {
  const { t } = useI18n();
  const known = options.some(([k]) => k === value);
  return (
    <div className="relative">
      <select className="vn-ink-input" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">{t('home.select')}</option>
        {!known && value ? <option value={value}>{value}</option> : null}
        {options.map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#c9a45c]" />
    </div>
  );
};

export const HomeView: React.FC<HomeViewProps> = ({ meta, onUpdateMeta, hasSaveGame, onPlay, onContinue, onOpenSettings, projects, activeProjectId, onSelectProject }) => {
  const { t, lang } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const coverSrc = useStoredImage(meta.coverImageId);

  const title = meta.title?.trim() || t('home.untitled');
  const list: ProjectSummary[] = projects && projects.length ? projects : [{ id: 'current', title, coverImageId: meta.coverImageId }];
  const activeIdx = Math.max(0, list.findIndex(p => p.id === (activeProjectId ?? list[0].id)));
  const go = (delta: number) => {
    if (list.length < 2 || !onSelectProject) return;
    onSelectProject(list[(activeIdx + delta + list.length) % list.length].id);
  };

  const update = (patch: Partial<ProjectMeta>) => onUpdateMeta({ ...meta, ...patch, lastEdited: Date.now() });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const id = crypto.randomUUID();
        await saveImage(id, ev.target?.result as string);
        const old = meta.coverImageId;
        update({ coverImageId: id });
        if (old) deleteImage(old).catch(() => {});
      } catch (err) {
        console.error('Failed to save project image', err);
        alert('Could not save the image.');
      }
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    const old = meta.coverImageId;
    update({ coverImageId: null });
    if (old) deleteImage(old).catch(() => {});
  };

  const edited = meta.lastEdited
    ? new Date(meta.lastEdited).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : t('home.never');

  const openPicker = () => fileRef.current?.click();

  return (
    <div className="h-full overflow-y-auto space-y-5 vn-bg-main p-4 md:p-6">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      {/* ============================ HERO ============================ */}
      <OrnateFrame className="relative overflow-hidden bg-gray-950" style={{ minHeight: 330 }}>
        {/* background image */}
        <div className="absolute inset-0">
          {coverSrc ? (
            <img src={coverSrc} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 75% 40%, rgba(60,84,150,.35), transparent 60%), linear-gradient(135deg,#0b1328,#0c152a 60%,#101a38)' }} />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(6,11,24,.92) 0%, rgba(6,11,24,.62) 45%, rgba(6,11,24,.25) 100%)' }} />
          <div className="absolute inset-x-0 bottom-0 h-24" style={{ background: 'linear-gradient(0deg, rgba(6,11,24,.8), transparent)' }} />
        </div>

        <div className="absolute top-3 right-5 vn-font-display text-[0.6rem] tracking-[0.35em] text-gray-300/80 uppercase hidden sm:block">
          Write &nbsp;·&nbsp; Build &nbsp;·&nbsp; Belong
        </div>

        <div className="relative z-10 flex flex-col md:flex-row gap-6 md:gap-10 p-6 md:p-8">
          {/* Project card */}
          <div className="relative shrink-0 mx-auto md:mx-0 pt-2">
            <OrnateFrame className="relative w-[190px] h-[262px] bg-gray-950 group">
              <div className="vn-ribbon"><Feather size={13} /></div>
              {coverSrc ? (
                <img src={coverSrc} alt="" className="absolute inset-[5px] w-[calc(100%-10px)] h-[calc(100%-10px)] object-cover" />
              ) : (
                <button onClick={openPicker} className="absolute inset-[5px] flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-emerald-300 transition-colors border border-dashed border-gray-600">
                  <Castle size={42} strokeWidth={1.2} />
                  <span className="vn-font-display text-[0.6rem] tracking-[0.2em] uppercase">{t('home.image.upload')}</span>
                </button>
              )}
              <div className="absolute inset-x-[5px] bottom-[5px] vn-card-caption pt-10 pb-3 px-2 text-center pointer-events-none">
                <div className="vn-font-display text-[0.8rem] tracking-[0.18em] text-emerald-300 uppercase leading-tight line-clamp-2">{title}</div>
                {meta.tagline && <div className="vn-font-serif italic text-[0.78rem] text-gray-300 mt-1 line-clamp-1">{meta.tagline}</div>}
              </div>
            </OrnateFrame>
          </div>

          {/* Title + actions */}
          <div className="flex-1 flex flex-col items-center md:items-start justify-center text-center md:text-left min-w-0">
            <div className="vn-font-display text-[0.6rem] tracking-[0.4em] text-gray-300/80 uppercase mb-3">{t('app.name')}</div>
            <h1 className="vn-hero-title break-words max-w-full">{title}</h1>
            {meta.tagline && (
              <p className="vn-font-serif italic text-lg md:text-xl text-gray-200 mt-4">“{meta.tagline}”</p>
            )}
            <div className="flex flex-wrap justify-center md:justify-start gap-4 mt-8">
              <FantasyButton primary icon={<Play size={20} />} onClick={onPlay}>{t('home.begin')}</FantasyButton>
              <FantasyButton icon={<BookOpen size={20} />} onClick={onContinue} disabled={!hasSaveGame}>{t('home.continue')}</FantasyButton>
              <FantasyButton icon={<SettingsIcon size={20} />} onClick={onOpenSettings}>{t('home.settings')}</FantasyButton>
            </div>
          </div>
        </div>
      </OrnateFrame>

      {/* ======================= DETAILS + EMBLEM ======================= */}
      <div className="vn-parchment relative p-5 md:p-7">
        <i className="vn-corner tl" /><i className="vn-corner tr" /><i className="vn-corner bl" /><i className="vn-corner br" />
        <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1px_1fr] gap-6 lg:gap-8">
          {/* Details */}
          <div className="space-y-3">
            <h3 className="vn-font-display text-[0.95rem] tracking-[0.2em] uppercase text-[#2b2113] mb-4">{t('home.details')}</h3>
            <Row label={t('home.field.title')}>
              <input className="vn-ink-input" value={meta.title || ''} placeholder={t('home.placeholder.title')} onChange={e => update({ title: e.target.value })} />
            </Row>
            <Row label={t('home.field.tagline')}>
              <input className="vn-ink-input" value={meta.tagline || ''} placeholder={t('home.placeholder.tagline')} onChange={e => update({ tagline: e.target.value })} />
            </Row>
            <Row label={t('home.field.genre')}><SelectField value={meta.genre} options={GENRES} onChange={v => update({ genre: v })} /></Row>
            <Row label={t('home.field.tone')}><SelectField value={meta.tone} options={TONES} onChange={v => update({ tone: v })} /></Row>
            <Row label={t('home.field.length')}><SelectField value={meta.targetLength} options={LENGTHS} onChange={v => update({ targetLength: v })} /></Row>
            <Row label={t('home.field.image')}>
              <div className="flex items-center gap-2">
                <button type="button" onClick={openPicker} className="vn-ink-input !w-auto !h-[34px] flex items-center gap-2 px-3 !text-[0.9rem] hover:brightness-125">
                  <ImagePlus size={14} className="text-[#c9a45c]" />{coverSrc ? t('home.image.change') : t('home.image.upload')}
                </button>
                {meta.coverImageId && (
                  <button type="button" onClick={removeImage} title={t('home.image.remove')} className="p-2 text-[#6b1a28] hover:text-[#a3293c]"><Trash2 size={15} /></button>
                )}
              </div>
            </Row>
            <Row label={t('home.field.edited')}>
              <span className="vn-label font-medium">{edited}</span>
            </Row>
            <p className="text-center vn-font-display text-[0.55rem] tracking-[0.35em] uppercase text-[#7a6540] pt-2">{t('home.footer')}</p>
          </div>

          <div className="hidden lg:block w-px" style={{ background: 'linear-gradient(180deg, transparent, #8a6f3a, transparent)' }} />

          {/* Emblem */}
          <div className="flex flex-col items-center">
            <h3 className="vn-font-display text-[0.95rem] tracking-[0.2em] uppercase text-[#2b2113] mb-4">{t('home.emblem')}</h3>
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => go(-1)} disabled={list.length < 2} title={t('home.emblem.prev')}
                className="w-7 h-12 flex items-center justify-center bg-[#1a2133] text-[#c9a45c] border border-[#8a6f3a] disabled:opacity-35 hover:brightness-125">
                <ChevronLeft size={16} />
              </button>
              <button type="button" onClick={openPicker} title={t('home.image.change')}
                className="vn-emblem w-[170px] h-[170px] bg-gray-950 flex items-center justify-center group">
                {coverSrc
                  ? <img src={coverSrc} alt="" className="w-full h-full object-cover" />
                  : <Castle size={54} strokeWidth={1.2} className="text-[#c9a45c] opacity-80" />}
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity text-[#e8cc87]"><ImagePlus size={26} /></span>
              </button>
              <button type="button" onClick={() => go(1)} disabled={list.length < 2} title={t('home.emblem.next')}
                className="w-7 h-12 flex items-center justify-center bg-[#1a2133] text-[#c9a45c] border border-[#8a6f3a] disabled:opacity-35 hover:brightness-125">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-4">
              {list.map((p, i) => (
                <button key={p.id} type="button" className={`vn-dot ${i === activeIdx ? 'active' : ''}`} title={p.title || t('home.untitled')} onClick={() => onSelectProject?.(p.id)} />
              ))}
            </div>
            <div className="vn-font-display text-[0.7rem] tracking-[0.15em] uppercase text-[#2b2113] mt-3 text-center truncate max-w-full">{title}</div>
            <p className="text-xs text-[#7a6540] mt-1 text-center vn-font-serif text-sm">{t('home.image.hint')}</p>

            <div className="mt-5 flex items-center gap-3 rounded px-4 py-3 w-full max-w-[360px]" style={{ background: 'linear-gradient(180deg,#3a2a1a,#241a10)', boxShadow: 'inset 0 0 0 1px rgba(201,164,92,.35)' }}>
              <div className="vn-seal"><Feather size={20} /></div>
              <span className="vn-font-serif italic text-[#e6d8b8] text-base">“{t('home.seal')}”</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
