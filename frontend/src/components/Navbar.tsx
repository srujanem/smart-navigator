import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass, Layers, Lock, Menu, Sparkles, X } from 'lucide-react';

interface NavbarProps {
  variant?: 'dark' | 'light';
}

export const Navbar: React.FC<NavbarProps> = ({ variant = 'dark' }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const isDark = variant === 'dark';

  return (
    <header
      className={`sticky top-0 z-40 transition-colors ${
        isDark
          ? 'bg-[#070B18]/80 backdrop-blur-xl border-b border-white/[0.08] text-white'
          : 'bg-white/85 backdrop-blur-xl border-b border-slate-200/80 text-slate-900'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-600 text-white shadow-lg shadow-cyan-500/25 ring-1 ring-white/20 transition-transform group-hover:scale-105">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`font-display text-lg font-extrabold tracking-tight ${
                  isDark ? 'text-white' : 'text-slate-950'
                }`}
              >
                Navigator
              </span>
              <span
                className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  isDark
                    ? 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/30'
                    : 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
                }`}
              >
                <Sparkles className="h-2.5 w-2.5" />
                Spatial AI
              </span>
            </div>
            <p
              className={`hidden text-[11px] sm:block ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              Photo-Based Indoor Positioning & Routing
            </p>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          <Link
            to="/venues"
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              location.pathname.startsWith('/venues')
                ? isDark
                  ? 'bg-white/10 text-white'
                  : 'bg-slate-100 text-slate-900'
                : isDark
                  ? 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Live Venues
          </Link>
          <a
            href="/#how-it-works"
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              isDark
                ? 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            How It Works
          </a>
          <a
            href="/#worlds"
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              isDark
                ? 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Use Cases
          </a>
          <a
            href="/#privacy"
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              isDark
                ? 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Zero-Hardware Privacy
          </a>
        </nav>

        {/* Actions */}
        <div className="hidden md:flex items-center gap-2.5">
          <Link
            to="/admin"
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              isDark
                ? 'bg-white/[0.07] text-slate-200 ring-1 ring-white/15 hover:bg-white/[0.12] hover:text-white'
                : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200/70 hover:text-slate-900'
            }`}
          >
            <Lock className="h-3.5 w-3.5 text-cyan-400" />
            Admin Studio
          </Link>
          <Link
            to="/venues"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-cyan-500/20 hover:from-cyan-400 hover:to-indigo-500 transition"
          >
            <Layers className="h-3.5 w-3.5" />
            Explore Venues
          </Link>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className={`md:hidden rounded-lg p-2 ${
            isDark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'
          }`}
          aria-label="Toggle Menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className={`md:hidden border-t px-4 py-4 space-y-2 ${
            isDark
              ? 'border-white/10 bg-[#070B18]/95 text-white'
              : 'border-slate-200 bg-white text-slate-900'
          }`}
        >
          <Link
            to="/venues"
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-cyan-500/10"
          >
            Explore Live Venues
          </Link>
          <a
            href="/#how-it-works"
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm font-medium opacity-80 hover:opacity-100"
          >
            How It Works
          </a>
          <a
            href="/#privacy"
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg px-3 py-2 text-sm font-medium opacity-80 hover:opacity-100"
          >
            Privacy Architecture
          </a>
          <div className="pt-2 flex gap-2">
            <Link
              to="/admin"
              onClick={() => setMobileOpen(false)}
              className="flex-1 text-center rounded-xl py-2.5 text-xs font-semibold ring-1 ring-slate-400/30"
            >
              Admin Studio
            </Link>
            <Link
              to="/venues"
              onClick={() => setMobileOpen(false)}
              className="flex-1 text-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 py-2.5 text-xs font-semibold text-white"
            >
              Open Venues
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};
