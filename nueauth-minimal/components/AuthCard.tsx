import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, User, KeyRound } from 'lucide-react';
import { InputField } from './ui/InputField';
import { Button } from './ui/Button';

type AuthMode = 'login' | 'signup';

export const AuthCard: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [isLoading, setIsLoading] = useState(false);

  const toggleMode = () => {
    setMode(prev => prev === 'login' ? 'signup' : 'login');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate network request
    setTimeout(() => {
      setIsLoading(false);
      alert(`${mode === 'login' ? 'Logged in' : 'Signed up'} successfully!`);
    }, 1500);
  };

  return (
    <div className="w-full max-w-[380px] perspective-1000 mx-auto">
      {/* 
        Glass Card Container 
        - Responsive padding: p-6 on mobile, p-10 on desktop
        - Improved spacing
      */}
      <div className="
        relative overflow-hidden
        rounded-[24px] md:rounded-[30px]
        bg-gradient-to-b from-white/10 to-white/5
        backdrop-blur-3xl 
        border border-white/10 
        shadow-[0_8px_32px_0_rgba(0,0,0,0.36)]
        p-6 md:p-10
      ">
        
        {/* Top Shine */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>

        {/* Header Section */}
        <div className="text-center mb-5 md:mb-8 space-y-2 relative z-10">
            <div className="inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/5 border border-white/10 shadow-lg backdrop-blur-md mb-2 md:mb-4 group transition-transform hover:scale-105 duration-500">
               {mode === 'login' ? (
                 <KeyRound className="text-creme-100/90 drop-shadow-lg" size={22} /> 
               ) : (
                 <User className="text-creme-100/90 drop-shadow-lg" size={22} />
               )}
            </div>
            <h1 className="font-serif text-2xl md:text-3xl text-creme-50 tracking-wide drop-shadow-sm">
                {mode === 'login' ? 'Welcome back' : 'Join Aether'}
            </h1>
            <p className="text-creme-100/50 text-xs md:text-sm font-light px-4">
                {mode === 'login' 
                    ? 'Enter your credentials to access the flow.' 
                    : 'Begin your journey with a new account.'}
            </p>
        </div>

        {/* Form Section - tightened space-y on mobile */}
        <form onSubmit={handleSubmit} className="space-y-3 md:space-y-5 relative z-10">
            {mode === 'signup' && (
                 <InputField 
                    label="Full Name"
                    placeholder="e.g. Jane Doe"
                    icon={User}
                    required
                />
            )}

            <InputField 
                label="Email"
                type="email"
                placeholder="name@company.com"
                icon={Mail}
                required
            />

            <div className="space-y-1">
                <InputField 
                    label="Password"
                    type="password"
                    placeholder="••••••••"
                    icon={Lock}
                    required
                />
                {mode === 'login' && (
                    <div className="flex justify-end">
                        <a href="#" className="text-xs text-creme-100/40 hover:text-creme-100 transition-all focus:outline-none focus:underline">
                            Forgot password?
                        </a>
                    </div>
                )}
            </div>

            <div className="pt-2">
                <Button type="submit" isLoading={isLoading}>
                    {mode === 'login' ? 'Sign In' : 'Create Account'}
                    {!isLoading && <ArrowRight size={18} className="ml-1 opacity-80" />}
                </Button>
            </div>
        </form>

        {/* Footer / Toggle Section */}
        <div className="mt-5 md:mt-8 pt-5 md:pt-6 border-t border-white/5 text-center relative z-10">
            <p className="text-creme-100/40 text-xs md:text-sm font-light">
                {mode === 'login' ? "New here?" : "Already a member?"}
                <button 
                    onClick={toggleMode}
                    className="ml-2 font-medium text-creme-100 hover:text-white hover:underline focus:outline-none transition-colors"
                >
                    {mode === 'login' ? 'Sign up' : 'Log in'}
                </button>
            </p>
        </div>

      </div>
    </div>
  );
};