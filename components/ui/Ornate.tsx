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
