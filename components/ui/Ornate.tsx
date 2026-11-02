import React from 'react';

/** Gold double-line frame with corner ornaments (needs .vn-theme ancestor / theme.css) */
export const OrnateFrame: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...rest }) => (
  <div className={`vn-frame ${className}`} {...rest}>
    <i className="vn-corner tl" /><i className="vn-corner tr" /><i className="vn-corner bl" /><i className="vn-corner br" />
    {children}
  </div>
);

interface FantasyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  primary?: boolean;
  inline?: boolean;
}

/** Dark/burgundy ornate button used on the home screen and settings */
export const FantasyButton: React.FC<FantasyButtonProps> = ({ icon, primary, inline, className = '', children, ...rest }) => (
  <button
    className={`vn-btn ${primary ? 'vn-btn--primary' : ''} ${inline ? 'vn-btn--inline' : ''} ${className}`}
    {...rest}
  >
    {!inline && <><i className="vn-pip top" /><i className="vn-pip bottom" /></>}
    {icon}
    <span>{children}</span>
  </button>
);

/** Thin gold divider with a diamond in the middle */
export const GoldRule: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    <hr className="vn-rule flex-1" />
    <span className="block w-1.5 h-1.5 rotate-45" style={{ background: 'var(--vn-gold)' }} />
    <hr className="vn-rule flex-1" />
  </div>
);

/** Page title block used by every editor screen: gold Cinzel title, serif subtitle, optional actions, gold rule */
export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, icon, actions, className = '' }) => (
  <div className={`space-y-3 flex-shrink-0 ${className}`}>
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h2 className="text-3xl text-emerald-300 vn-font-display flex items-center gap-3">{icon}{title}</h2>
        {subtitle && <p className="text-gray-400 text-sm mt-1 vn-font-serif text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    <GoldRule />
  </div>
);

/** Ornate section card (gold double frame, gold uppercase heading) */
export const Panel: React.FC<{
  title?: string;
  icon?: React.ReactNode;
  hint?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, icon, hint, actions, className = '', children }) => (
  <OrnateFrame className={`bg-gray-900/80 p-6 space-y-4 ${className}`}>
    {(title || actions) && (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <h3 className="text-base font-semibold text-emerald-300 flex items-center gap-2 uppercase">{icon}{title}</h3>}
          {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
        </div>
        {actions}
      </div>
    )}
    {children}
  </OrnateFrame>
);

/** Placeholder for empty lists / nothing selected */
export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  text?: string;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon, title, text, action, className = '' }) => (
  <div className={`vn-empty flex flex-col items-center justify-center text-center gap-2 px-6 py-10 ${className}`}>
    {icon && <div className="text-emerald-500 opacity-70">{icon}</div>}
    <div className="vn-font-display text-sm uppercase tracking-[0.15em] text-emerald-300">{title}</div>
    {text && <p className="vn-font-serif text-base text-gray-400 max-w-md">{text}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);
