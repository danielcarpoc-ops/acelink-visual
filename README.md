# AceLink Visual

A modern, visual desktop application for Ace Stream playback on macOS.

## Features
- **Visual Dashboard:** Paste Ace Stream IDs or Magnet links directly.
- **Embedded Player:** Try to play streams directly within the app.
- **VLC Integration:** One-click fallback to open streams in VLC.
- **Automatic Engine Management:** Handles the Docker container in the background.

## Prerequisites
- **Docker Desktop** must be installed and running.
- **VLC** (optional but recommended for best compatibility).

## Installation

1. Clone or download this repository.
2. Install dependencies:
   ```bash
   npm install
   ```

## Running the App

Start the development server (Hot Reload):
```bash
npm run dev
```

## Building for Production

Build the application:
```bash
npm run build
```
To package it (create a .dmg or .app):
```bash
npm install -D electron-builder
npm run build
npx electron-builder
```

## Troubleshooting
- If the stream doesn't load in the embedded player, click the "Open External" button or the icon in the top right of the player to open in VLC.
- Ensure Docker is running before starting the app.
