# Glot Frontend

A responsive, mobile-first PWA shell built with Next.js, Tailwind CSS, and Shadcn/UI.

## Tech Stack

- **Framework:** Next.js 16+ (App Router)
- **Runtime:** Bun
- **Styling:** Tailwind CSS v4
- **Components:** Shadcn/UI
- **Icons:** Lucide React
- **Theming:** next-themes (System/Light/Dark)

## Quick Start

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Build for production
bun run build

# Start production server
bun run start
```

## Project Structure

```
src/
├── app/                    # App Router pages
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # My Day (Dashboard)
│   ├── library/           # Library view
│   ├── refinery/          # Refinery (draft cards inbox)
│   ├── decks/             # Decks management
│   └── session/           # Active flashcard session
├── components/
│   ├── layout/            # Shell components
│   │   ├── app-shell.tsx  # Main responsive shell
│   │   ├── sidebar.tsx    # Desktop sidebar
│   │   ├── bottom-nav.tsx # Mobile bottom navigation
│   │   └── header.tsx     # Global header
│   ├── providers/         # Context providers
│   │   └── theme-provider.tsx
│   └── ui/                # Shadcn/UI components
└── lib/
    └── utils.ts           # Utility functions (cn)
```

## Design System

### Theme Colors
- **Light Mode:** Paper-like off-white (`#FDFBF7`) with warm accents
- **Dark Mode:** Deep charcoal/slate (`#0F172A`)
- **Accent:** Golden yellow (`#C9A227`) for interactive elements

### Typography
- **UI Elements:** Geist Sans (system default)
- **Content:** Merriweather (serif) for book-like reading experience

### Responsive Breakpoints
- **Mobile:** < 768px (md) - Bottom tab bar navigation
- **Desktop:** ≥ 768px (md) - Left sidebar navigation

## Views

### My Day (Dashboard)
- Circular progress indicator showing reviews due
- Quick stats widgets (streak, time, mastered)
- Horizontal-scrolling recent books carousel
- Start Session CTA

### Library
- Grid/List view toggle
- Search and filter functionality
- Book cards with cover, title, progress

### Refinery
- Inbox-style list of draft cards
- Expandable card details
- Approve/Reject actions
- Confidence badges

### Decks
- Deck cards with mastery progress
- New/Due card counts
- Study actions

### Active Session
- Large centered flashcard with 3D flip animation
- FSRS rating buttons (Again, Hard, Good, Easy)
- Progress tracking
- Keyboard shortcuts

## PWA Features

The app is configured as a Progressive Web App:
- Manifest at `/public/manifest.json`
- Theme colors adapt to light/dark mode
- Optimized for iOS home screen installation
