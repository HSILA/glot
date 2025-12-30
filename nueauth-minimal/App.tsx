import React from 'react';
import { AuthCard } from './components/AuthCard';
import { Wind } from 'lucide-react';

const App: React.FC = () => {
  return (
    <div className="min-h-[100dvh] bg-obsidian-950 flex flex-col relative overflow-x-hidden selection:bg-creme-500 selection:text-obsidian-950">
      
      {/* Liquid Ambient Background - Fixed position to stay in place during scroll */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-40">
          <div className="absolute top-0 left-[-100px] w-[500px] h-[500px] bg-creme-800 rounded-full mix-blend-screen filter blur-[100px] animate-pulse" style={{ animationDuration: '4s' }}></div>
          <div className="absolute bottom-0 right-[-100px] w-[500px] h-[500px] bg-obsidian-800 rounded-full mix-blend-screen filter blur-[100px] opacity-70"></div>
          <div className="absolute top-[20%] right-[20%] w-[300px] h-[300px] bg-creme-900/40 rounded-full mix-blend-overlay filter blur-[60px]"></div>
        </div>
      </div>

      {/* Navigation / Header - Relative positioning to prevent collision */}
      <header className="w-full p-6 flex justify-between items-center z-10 relative shrink-0">
        <div className="flex items-center gap-2 text-creme-100">
          <div className="w-8 h-8 bg-white/10 backdrop-blur-md border border-white/10 text-creme-50 rounded-lg flex items-center justify-center shadow-lg">
            <Wind size={16} />
          </div>
          <span className="font-serif text-lg tracking-tight font-medium opacity-90">Aether</span>
        </div>
      </header>

      {/* Main Content - Flex grow to center vertically, with padding adjustment for mobile */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 z-20">
        <AuthCard />
      </main>

      {/* Footer */}
      <footer className="w-full p-6 text-center text-creme-100/30 text-sm font-sans z-10 relative shrink-0">
        &copy; {new Date().getFullYear()} Aether Inc. All rights reserved.
      </footer>
    </div>
  );
};

export default App;