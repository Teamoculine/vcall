# vcall

A minimal, end-to-end encrypted, peer-to-peer voice call template built on WebRTC and WebSockets. No accounts, no media servers, no dependencies beyond a lightweight signaling relay.

Designed to be forked and built on top of.

---

## How it works

vcall uses WebRTC for the actual audio stream — the media travels directly between the two peers. The signaling server (`server.js`) is a WebSocket relay whose only job is to exchange the offer, answer, and ICE candidates needed to establish that peer connection. Once the call is live, the server is out of the picture.

```
caller                  server                  callee
  |  -- create(code) -->  |                       |
  |  <-- created ------   |                       |
  |                       |  <-- join(code) ----- |
  |  <-- peer-joined --   |  -- joined -------->  |
  |  -- offer ----------> |  -- offer --------->  |
  |                       |  <-- answer --------  |
  |  <-- answer --------  |                       |
  |  <-- ice-candidate -  |  -- ice-candidate --> |
  |  -- ice-candidate --> |  <-- ice-candidate -- |
  |  === direct p2p audio stream ================ |
```

---

## Project structure

```
vcall/
├── server.js          # WebSocket signaling server (Node.js)
├── package.json
└── client/
    └── index.html     # Entire frontend — HTML, CSS, JS in one file
```

---

## Running locally

### Requirements

- Node.js 18+
- A browser with WebRTC support (every modern browser)

### Steps

```bash
git clone https://github.com/Teamoculine/vcall.git
cd vcall
npm install
npm start
```

The signaling server starts on port `8080` by default. You can override it with the `PORT` environment variable:

```bash
PORT=3000 npm start
```

Then open `client/index.html` directly in your browser, but you need to point it at your local server first. In `index.html`, find this line near the top of the `<script>` block:

```js
const WS_URL = 'wss://vcall-9j7h.onrender.com';
```

Change it to:

```js
const WS_URL = 'ws://localhost:8080';
```

Note: `ws://` (not `wss://`) for local development since there's no TLS. Open the file in two browser tabs, generate a call in one, paste the code into the other.

---

## Deploying

### Signaling server

The server is a plain Node.js process with a single dependency (`ws`). It runs anywhere that can run Node — Render, Railway, Fly.io, a VPS, etc.

**Render (what the demo uses):**

1. Push your repo to GitHub.
2. Create a new Web Service on Render, point it at the repo.
3. Build command: *(leave blank)*
4. Start command: `npm start`
5. Render assigns a URL like `vcall-xxxx.onrender.com`. That's your signaling server.

The `PORT` environment variable is set automatically by Render.

### Client

The client is a single static HTML file with zero build step. Deploy it anywhere that serves static files — Netlify, Vercel, GitHub Pages, Cloudflare Pages, or just drop it in an S3 bucket.

Before deploying, set `WS_URL` in `index.html` to point at your deployed signaling server using `wss://` (secure WebSocket, required when the client is served over HTTPS):

```js
const WS_URL = 'wss://your-server.onrender.com';
```

---

## Customizing / using as a template

### Config constants

At the top of the `<script>` block in `index.html`:

```js
const WS_URL = 'wss://your-signaling-server.com';  // Your deployed server
const STUN  = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
```

`STUN` is passed directly to `RTCPeerConnection`. You can swap in any STUN/TURN configuration here — see the TURN section below.

### Adding TURN support

The default config only includes a STUN server. STUN works for most home networks but fails when peers are behind symmetric NAT (common on corporate networks, university WiFi, mobile hotspots). For reliable connections across all network types, add a TURN server:

```js
const STUN = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'your-username',
      credential: 'your-credential',
    }
  ]
};
```

Free/cheap TURN options: [Metered](https://www.metered.ca/tools/openrelay/), [Open Relay](https://www.metered.ca/tools/openrelay/), or self-host [coturn](https://github.com/coturn/coturn).

### Adding video

In `getMic()`, change:

```js
localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
```

to:

```js
localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
```

Then add a `<video>` element to the HTML and assign `e.streams[0]` to it in the `pc.ontrack` handler alongside the existing audio element.

### Changing the code length or format

Code generation is in the `genCode()` function:

```js
function genCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
```

Change `12` to whatever length you want, or swap the character set. If you change the length, update the validation in `joinCall()` to match:

```js
if (code.length !== 12) { ... }  // change 12 here too
```

### Signaling message types

The full set of messages passed between client and server:

| Type | Direction | Description |
|---|---|---|
| `create` | client → server | Register a new room with a code |
| `created` | server → client | Confirms room was created |
| `join` | client → server | Join an existing room by code |
| `joined` | server → client | Confirms join was successful |
| `peer-joined` | server → caller | Notifies caller that callee connected |
| `offer` | relayed | SDP offer from caller to callee |
| `answer` | relayed | SDP answer from callee to caller |
| `ice-candidate` | relayed | ICE candidates in both directions |
| `hang-up` | client → server, relayed | Either peer ends the call |
| `room-closed` | server → client | Room expired or was cleared |
| `error` | server → client | `not-found`, `room-full`, `code-taken` |

### Room expiry

Rooms expire after 5 minutes of inactivity (caller waiting, no callee joins). Configured in `server.js`:

```js
const CODE_TTL = 5 * 60 * 1000; // milliseconds
```

---

## Limitations

- **Two peers only.** The signaling server supports exactly one caller and one callee per room. Multi-party calls would require a mesh or SFU architecture.
- **No TURN by default.** Connections will fail on symmetric NAT without adding a TURN server.
- **No authentication.** Anyone who knows a valid code can join the room. If you need access control, add it at the signaling layer.
- **Codes are not secret.** The 12-character alphanumeric code has ~2 trillion combinations, making brute force impractical but not impossible. Don't use this for anything requiring strong access guarantees without additional auth.
