import React, { useEffect } from 'react';
import { OrnateFrame, FantasyButton } from './Ornate';

export interface DialogAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface DialogProps {
  title: string;
  actions: DialogAction[];
  onClose: () => void;
  children: React.ReactNode;
}

/** Modal in the editor theme (rendered outside the editor shell, so it brings its own .vn-theme) */
export const Dialog: React.FC<DialogProps> = ({ title, actions, onClose, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="vn-theme fixed inset-0 z-[400] flex items-center justify-center bg-black/75 p-4" onMouseDown={onClose}>
      <OrnateFrame className="w-full max-w-md bg-gray-900 p-6 space-y-4" onMouseDown={(e: React.MouseEvent) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="text-lg text-emerald-300 uppercase">{title}</h3>
        <div className="text-sm text-gray-300 leading-relaxed vn-font-serif text-base">{children}</div>
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          {actions.map(a => (
            <FantasyButton key={a.label} inline primary={a.primary} onClick={a.onClick}>{a.label}</FantasyButton>
          ))}
        </div>
      </OrnateFrame>
    </div>
  );
};
