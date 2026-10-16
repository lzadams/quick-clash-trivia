# Quick Clash — real-time multiplayer trivia

An actual server-based multiplayer game, supporting **2–8 players joining from separate devices over the internet**. Players share a six-character room code, answer the same questions, and see synchronized scores.

## Rules

- One host creates a room. Other players join using a code or invitation link.
- Only the host can start after at least two players have joined; maximum eight players.
- Three rounds of five questions each (15 total).
- Each multiple-choice question has a 15-second limit. Only the first submitted answer counts.
- Correct answer: 100 points plus 0–50 bonus points for speed. Wrong or missed: 0 points.
- Correct choice and scores are revealed after each question. All players see the same question and round transitions.
- Highest score after 15 questions wins. Ties share victory.

## Run locally

Requirements: Node.js 20 or later.

```sh
npm install
npm start
```

Open http://localhost:3000. For independent local testing, open two browsers or devices on the same network using your computer's LAN IP and port 3000.

## Publish to a public URL with Render

This application needs a persistent Node.js server for WebSockets, and **cannot be deployed as a static Netlify Drop site**.

1. Upload this project into a GitHub repository.
2. At https://dashboard.render.com create a **New Web Service** and connect the repository.
3. Choose **Node** runtime, build command `npm install`, start command `npm start`.
4. Choose a suitable plan and deploy. Render provides a publicly reachable HTTPS URL.
5. Share the public URL with a friend. Open it on two devices and play a whole game.

No API keys or external database are needed. Rooms live in the server's memory, and are cleared on server restart. For reliability, use **one running instance** (no horizontal scaling). Free-tier services may sleep when idle and delay reconnection. Disconnecting mid-game marks the player offline and they cannot rejoin that active game; refresh and start a new room. For production at scale, use a shared database or Redis adapter and player reconnection tokens.

Health check: `/health`.
