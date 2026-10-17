import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', className = '', children, ...props }) => {
  const baseStyles = "px-4 py-2 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20",
    secondary: "bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600",
    danger: "bg-red-600 hover:bg-red-500 text-white",
    ghost: "bg-transparent hover:bg-gray-800 text-gray-400 hover:text-white",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`} 
      {...props}
    >
      {children}
    </button>
  );
};