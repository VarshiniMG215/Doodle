# Doodle Online

Draw and guess with friends in a private room. Make a room, share the link, and everyone who opens it joins live.

## How to run
1. Install Node.js from nodejs.org
2. Open this folder in a terminal and run:
   ```
   npm install
   npm start
   ```
3. Open http://localhost:3000 in your browser

To test it alone, open the link in two or three browser tabs.

## How to play
1. Enter your name and click **Create private room**.
2. Copy the link and send it to your friends. When they open it, they enter a name and join.
3. The host picks rounds, drawing time and the word pack (English or Kannada), then starts the game.
4. Each turn one player draws the secret word and the others type guesses in the chat.
5. Faster guesses give more points. The drawer also gets points when people guess.

## Features
- Private rooms with a shareable link (up to 8 players)
- Live drawing that shows up for everyone instantly
- Chat guessing, hint letters that appear over time, scoreboard
- Kannada word pack
- Players who join late see the drawing so far
- Host moves to the next player if the host leaves

## What I used
HTML5, CSS3 (Flexbox, Grid, media queries), JavaScript, Canvas API, Pointer Events (mouse and touch), Node.js, Express, Socket.IO.

## How it works
The browser draws on the canvas and sends each small line to the server. The server passes it to everyone else in the same room. The secret word is only sent to the drawer, and the server checks every guess, so players can't cheat from the browser.

## Putting it online
GitHub Pages can't run a Node server, so deploy it on a host like Render: connect the GitHub repo, set the build command to `npm install` and the start command to `npm start`. The free plan sleeps when idle, so the first load can take about 30 seconds.

## Ideas for later
- Word choice (pick 1 of 3)
- Undo button
- Public rooms
- Stroke-by-stroke replay after each turn
