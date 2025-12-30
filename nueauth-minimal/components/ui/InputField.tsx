import React, { useState } from 'react';
import { Eye, EyeOff, LucideIcon } from 'lucide-react';

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: LucideIcon;
  error?: string;
}

export const InputField: React.FC<InputFieldProps> = ({ 
  label, 
  icon: Icon, 
  type = 'text', 
  className = '', 
  error,
  ...props 
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  
  // If it's a password field and we are showing it, turn type to text
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label className="block text-xs font-medium text-creme-100/60 uppercase tracking-wider ml-1">
          {label}
        </label>
      )}
      <div className="relative group">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-creme-100/30 group-focus-within:text-creme-100/80 transition-colors duration-200">
            <Icon size={18} />
          </div>
        )}
        
        <input
          type={inputType}
          className={`
            w-full bg-black/20 border border-white/5 text-creme-50 placeholder-creme-100/20
            rounded-xl py-3 ${Icon ? 'pl-10' : 'pl-4'} ${isPassword ? 'pr-10' : 'pr-4'}
            focus:outline-none focus:ring-1 focus:ring-creme-500/50 focus:bg-black/30 focus:border-creme-500/20
            transition-all duration-300 shadow-inner
            selection:bg-creme-500 selection:text-obsidian-950
            ${error ? 'border-red-400/50 focus:ring-red-400/30' : ''}
            ${className}
          `}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-creme-100/30 hover:text-creme-100 transition-colors focus:outline-none"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {error && <p className="text-red-300/80 text-xs ml-1 font-light">{error}</p>}
    </div>
  );
};