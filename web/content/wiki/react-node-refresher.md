---
title: React + Node.js — Hands-On Developer Refresher
summary: A three-tier app end to end — React + Vite + TypeScript, a Node/Express BFF, and a Python ML service — with the modern idioms and the decisions worth defending.
topic: app-development
format: refresher
tags: [react, nodejs, typescript, vite, express, bff, fastapi, hooks]
updated: 2026-08-07
---

## Frame

This is a refresher for someone whose architecture instincts are current but whose fingers are not — the failure mode being to sound like **someone who last touched a component three years ago and now delegates the actual typing**. The cure is building something small and complete rather than reading about the ecosystem.

The reference application throughout is a **three-tier app**: a **React + Vite + TypeScript** frontend uploads an image, a **Node.js (Express) BFF** proxies the multipart upload to a **Python FastAPI** ML service running a model, and the results render back in React. Every concept below ties back to a specific line of that shape, because a concept you can point at in running code is one you actually have.

Three mental models to hold going in:

1. **Talk about *a specific codebase*, not "React in general."** Asked how you handle side effects, don't recite `useEffect` — "the upload component fires the `fetch` on submit, not in an effect, because it's a user action; the only effect manages the object-URL preview and cleans it up." Specifics beat theory, and they are also how you find out whether you understood it.
2. **The BFF is the interesting architectural choice.** The obvious build lets React `fetch` the ML service directly. Putting a **Backend-for-Frontend** in the middle is deliberate: CORS, request shaping, auth injection, timeouts, multipart forwarding, and keeping the ML service off the public internet. That single decision is where senior instincts show up in a small app.
3. **Modern idioms, current tooling.** In 2026 the defaults are **function components + hooks** (no classes), **Vite** (not Create-React-App, which is deprecated), **TypeScript everywhere**, **Vitest** (not bare Jest) for a Vite app, and **fetch** (no axios needed). Say the current thing and you sound like you shipped last month, not last decade.

The bar this guide aims at: being able to read a ticket, open the editor, and change a component and an endpoint the same afternoon.

---

# Section 1 — Modern React: the hooks model

## 1a. Function components + the core hooks

Everything is a **function component** now. No `class`, no `this`, no lifecycle methods. State and side effects come from **hooks** — functions starting with `use` that must be called at the top level of a component (never inside conditions or loops — that's the "Rules of Hooks").

| Hook | What it does | Where it shows up in the reference app |
|---|---|---|
| `useState` | Local component state; returns `[value, setter]` | The selected file, the preview URL, the request status, the result |
| `useEffect` | Run a side effect after render; optional cleanup | Revoking the object URL when the file changes/unmounts |
| `useRef` | Mutable box that survives renders without causing re-render; also DOM refs | The hidden `<input type="file">` ref; the `<canvas>` ref for the mask overlay |
| `useMemo` | Memoize an expensive computed value | Deriving `coveragePct` formatting only when the result changes |
| `useCallback` | Memoize a function identity across renders | A stable `onUpload` passed to a child button |
| `useContext` | Read a value from a React Context without prop-drilling | (Awareness-level — the demo is small enough not to need it) |

```tsx
const [file, setFile] = useState<File | null>(null);
const [status, setStatus] = useState<RequestState>({ kind: "idle" });
const inputRef = useRef<HTMLInputElement>(null);
```

**Key mental correction for an architect:** `useState`'s setter is **asynchronous within the render** — calling `setStatus(...)` does not immediately mutate `status`; React schedules a re-render and you read the new value next render. When new state depends on old state, use the **functional updater**: `setCount(c => c + 1)`, never `setCount(count + 1)` inside async code.

## 1b. Effects: dependency arrays, cleanup, and the "runs twice" trap

`useEffect(fn, deps)` runs `fn` **after** the render commits. The **dependency array** controls *when it re-runs*:

- `useEffect(fn, [])` — run once after mount (and cleanup on unmount).
- `useEffect(fn, [a, b])` — run after mount and whenever `a` or `b` changed.
- `useEffect(fn)` — no array — run after **every** render (rarely what you want).

The **cleanup function** is what you `return` from the effect; React runs it before the next effect run and on unmount. The canonical the reference app example — an object URL leaks memory if you don't revoke it:

```tsx
useEffect(() => {
  if (!file) return;
  const url = URL.createObjectURL(file);
  setPreviewUrl(url);
  return () => URL.revokeObjectURL(url); // cleanup: free the blob URL
}, [file]);
```

**The interview trap: "why does my effect run twice in development?"** Since React 18, in **development** `StrictMode` deliberately **mounts, unmounts, and remounts** every component once, so effects run **twice on purpose**. This is a smoke test: if your effect isn't idempotent — if it can't run → cleanup → run again cleanly — you have a bug (a missing cleanup, a double subscription, a double fetch). It does **not** happen in production. The right answer is: *"StrictMode double-invokes effects in dev to surface missing cleanup; my effects are written to tolerate it, and the second run disappears in the production build."* Do **not** answer "so I disabled StrictMode" — that's the wrong instinct.

A related current idiom: **don't put data-fetching-on-user-action in an effect.** Fetching in response to a *click* belongs in the event handler. Effects are for **synchronizing with something external** (a subscription, a DOM node, a timer). This is exactly why the reference app's upload `fetch` lives in `onSubmit`, not in a `useEffect`.

## 1c. Controlled vs uncontrolled inputs

- **Controlled** — React state is the single source of truth; the input's `value` comes from state and `onChange` writes back. Predictable, validatable.
  ```tsx
  <input value={name} onChange={e => setName(e.target.value)} />
  ```
- **Uncontrolled** — the DOM holds the value; you read it via a `ref` when you need it. `<input type="file">` is the classic **necessarily uncontrolled** case — you cannot set a file input's value programmatically (security), so you read `inputRef.current.files[0]` or use the `onChange` event. the reference app's file input is uncontrolled by necessity; the *selected `File`* is then lifted into `useState`.

## 1d. Lifting state, composition, keys, reconciliation

- **Lifting state up** — when two siblings need the same data, move the state to their **common parent** and pass it down as props. In the reference app the parent `<App>` owns `file`, `status`, and `result`; `<UploadPanel>` and `<ResultView>` are presentational children.
- **Composition over configuration** — build small components and compose them (`children`, render props) rather than one giant component with 20 props.
- **Keys & reconciliation** — React diffs the virtual DOM against the previous render to compute the minimal real-DOM update ("reconciliation"). When rendering a **list**, each item needs a **stable, unique `key`** so React can track identity across renders. **Never use the array index as a key** for lists that reorder/filter — it causes state to attach to the wrong row. Use a real id.

## 1e. Custom hooks

A **custom hook** is just a function starting with `use` that calls other hooks — the standard way to extract and reuse stateful logic. the reference app factors the upload flow into one:

```tsx
function useContrailAnalysis() {
  const [status, setStatus] = useState<RequestState>({ kind: "idle" });

  const analyze = useCallback(async (file: File) => {
    setStatus({ kind: "loading" });
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      if (!res.ok) throw new Error(`BFF returned ${res.status}`);
      const data: AnalysisResult = await res.json();
      setStatus({ kind: "success", data });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  }, []);

  return { status, analyze };
}
```

That hook is the single best thing to walk them through: it shows hooks, `useCallback`, async/await, `FormData`, error handling, and the discriminated-union status all at once.

## 1f. Error boundaries and Suspense (awareness level)

- **Error boundaries** catch render-time errors in a subtree and show a fallback instead of a white screen. They are still the one thing that **must** be a class component (or you use `react-error-boundary`). Awareness is enough: *"I'd wrap the result view in an error boundary so a bad payload doesn't blank the whole app."*
- **Suspense** lets a component "wait" for something (lazy-loaded code via `React.lazy`, or data with a Suspense-enabled library) and show a fallback meanwhile. the reference app uses simple loading state, not Suspense — say so honestly. Know that Suspense + `React.lazy` is how you code-split, and that frameworks (Next.js) lean on it heavily.

---

# Section 2 — Vite

## 2a. What Vite is and why it replaced CRA

**Vite** is the modern build tool and dev server for frontend apps. It matters that you can say *why* it won:

- **Dev server uses native ESM + esbuild.** Instead of bundling the whole app before you can see it (the old Webpack/CRA model), Vite serves your source as native ES modules and only transforms files the browser actually requests. Startup is near-instant regardless of app size.
- **HMR (Hot Module Replacement)** is fast and surgical — edit a component, the module swaps in place, component state is preserved, no full reload.
- **Production build uses Rollup** (`vite build`) — tree-shaken, minified, code-split bundles with hashed filenames.
- **Create-React-App is deprecated** (the React team retired it in 2025 and now points people to Vite or a framework). Saying "I use Vite, CRA is dead" is a currency signal.

Everyday commands: `npm run dev` (dev server + HMR), `npm run build` (production bundle to `dist/`), `npm run preview` (serve the built bundle locally).

## 2b. The Vite dev proxy — how the frontend reaches the BFF without CORS pain

In development the React app runs on `http://localhost:5173` and the Express BFF on `http://localhost:3000`. Different origins → CORS. Rather than loosen CORS in dev, the reference app uses Vite's **dev proxy**: any request to `/api/*` from the frontend is transparently forwarded to the BFF, so the browser only ever sees one origin.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
```

This is why the frontend code just calls `fetch("/api/analyze")` with a relative path — it works identically in dev (proxied) and in production (same origin, or fronted by a reverse proxy). Good talking point: *"relative `/api` paths + a dev proxy means my frontend never hardcodes a backend host."*

---

# Section 3 — TypeScript in React

## 3a. Typing props and state

```tsx
type ResultViewProps = {
  result: AnalysisResult;
  onReset: () => void;
};

function ResultView({ result, onReset }: ResultViewProps) { /* ... */ }
```

- **Props** — a `type` (or `interface`) describing the object the component receives; destructure in the signature.
- **State** — `useState` infers from the initial value, but annotate explicitly when the initial value doesn't capture the full type: `useState<File | null>(null)`, `useState<AnalysisResult | null>(null)`.
- **Refs** — `useRef<HTMLInputElement>(null)` for DOM refs; `useRef<number>(0)` for mutable values.

## 3b. Event types

The types that trip people up in a live screen — memorize these three:

```tsx
function onChange(e: React.ChangeEvent<HTMLInputElement>) { /* file input, text input */ }
function onSubmit(e: React.FormEvent<HTMLFormElement>)   { e.preventDefault(); /* ... */ }
function onClick(e: React.MouseEvent<HTMLButtonElement>)  { /* ... */ }
```

The pattern is `React.<X>Event<HTMLElementType>`. For a file input you read `e.target.files` (a `FileList | null`).

## 3c. Discriminated unions for request state — the idiom that reads as senior

Do **not** model an async request with four loose booleans (`isLoading`, `isError`, `data`, `error`) — they let you represent impossible states (loading *and* error at once). Use a **discriminated union** with a `kind` tag:

```ts
type AnalysisResult = {
  coveragePct: number;
  contrailCount: number;
  maskPngBase64: string; // segmentation mask overlay from the ML service
};

type RequestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: AnalysisResult }
  | { kind: "error"; message: string };
```

Now the compiler forces you to handle every case, and inside a `case "success":` block `state.data` is known to exist while `state.message` does not exist. Rendering becomes a clean switch:

```tsx
switch (status.kind) {
  case "idle":    return <Dropzone onFile={analyze} />;
  case "loading": return <Spinner label="Analyzing sky image…" />;
  case "error":   return <ErrorBanner message={status.message} />;
  case "success": return <ResultView result={status.data} />;
}
```

That single snippet exercises modern React *and* real TypeScript judgment together, which makes it the highest-value thing to have at your fingertips.

## 3d. The shared API contract type

The `AnalysisResult` type is **the contract between the BFF and the frontend**. In the reference app it lives in a small shared types file (or is duplicated deliberately). The BFF returns exactly this JSON shape; the frontend types the `res.json()` as `AnalysisResult`. That shared shape is what "typed API contract" means in a small full-stack app — talk about it as a design choice, not an accident.

---

# Section 4 — The image-upload component (the piece to be able to write live)

This is the component they are most likely to ask you to build or explain. Be able to produce something close to this from memory.

```tsx
function UploadPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { status, analyze } = useContrailAnalysis();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (file) analyze(file);
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onFileChange}
      />
      {previewUrl && <img src={previewUrl} alt="sky preview" width={320} />}
      <button type="submit" disabled={!file || status.kind === "loading"}>
        {status.kind === "loading" ? "Analyzing…" : "Analyze"}
      </button>

      {status.kind === "success" && (
        <ResultView result={status.data} original={previewUrl} />
      )}
      {status.kind === "error" && <p role="alert">{status.message}</p>}
    </form>
  );
}
```

Points to narrate while you write it:
- **File input is uncontrolled**; the selected `File` is lifted into state.
- **The preview** uses `URL.createObjectURL` (cheap, no base64) and is revoked in cleanup.
- **The button is disabled** while loading — prevents double-submit, a small correctness detail seniors notice.
- **`FormData` + `fetch`** (inside the hook) is how the binary file goes up; **you do not set `Content-Type` manually** — the browser sets `multipart/form-data` with the correct boundary automatically. Setting it by hand is a classic bug.

## 4a. Rendering the returned mask overlay

The ML service returns a segmentation **mask**. Two rendering approaches, both worth being able to speak to:

- **Simple: stacked `<img>`** — draw the original image, then absolutely-position the mask PNG (with transparency) on top at reduced opacity. Least code.
- **`<canvas>` overlay** — draw the original, then `ctx.drawImage(mask, 0, 0)` (or `putImageData`) to composite. Gives pixel control (blend mode, thresholding, alpha). the reference app uses a canvas so coverage can be visualized:

```tsx
function MaskCanvas({ original, maskPngBase64 }: MaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const base = new Image();
    base.onload = () => {
      canvas.width = base.width; canvas.height = base.height;
      ctx.drawImage(base, 0, 0);
      const mask = new Image();
      mask.onload = () => {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(mask, 0, 0);
        ctx.globalAlpha = 1;
      };
      mask.src = `data:image/png;base64,${maskPngBase64}`;
    };
    base.src = original;
  }, [original, maskPngBase64]);
  return <canvas ref={canvasRef} />;
}
```

The `getContext("2d")`, `drawImage`, and `globalAlpha` names are what prove you actually rendered a mask and didn't just describe one.

---

# Section 5 — Node.js & the event loop (right depth for a dev screen)

## 5a. The async model, briefly

Node runs your JavaScript on a **single main thread** with a **non-blocking event loop**. When you do I/O (read a socket, call another service, read a file), Node hands the work to the OS / libuv thread pool and **registers a callback**; the main thread keeps going and picks the result up later. This is why Node handles many concurrent connections cheaply — it isn't blocked waiting on I/O.

The dev-screen-depth points that matter:
- **Never block the event loop.** A synchronous CPU-heavy loop (or `fs.readFileSync` in a request handler) freezes *every* concurrent request. In the reference app the CPU-heavy work (running the U-Net) is deliberately **not** in Node — it's offloaded to the Python service. The BFF only does I/O (receive upload, forward, return), which is exactly what Node is good at.
- **`async/await` over callbacks.** Modern Node is promise-based; `await` reads sequentially but doesn't block the loop. Wrap awaited calls in `try/catch`.
- **Microtasks vs macrotasks** — awareness only: promise callbacks (microtasks) run before timers/I/O callbacks (macrotasks) within a loop tick. You won't be quizzed hard on this for a full-stack dev role; know the phrase "the event loop has phases."

## 5b. Express: routing and middleware

**Express** is the minimal HTTP framework. Two concepts run everything:

- **Routes** — `app.post("/analyze", handler)` maps method+path to a handler `(req, res)`.
- **Middleware** — functions `(req, res, next)` that run in order for each request; they can read/modify `req`/`res` and either respond or call `next()` to pass control on. CORS, body parsing, auth, logging, and error handling are all middleware.

```js
import express from "express";
const app = express();

app.use(express.json());              // parse JSON bodies (not used for the upload route)
app.use(cors({ origin: FRONTEND_URL })); // controlled CORS
app.use(requestLogger);               // custom logging middleware

app.post("/analyze", upload.single("image"), analyzeHandler);

app.use(errorHandler);                // error-handling middleware (4 args) goes LAST
app.listen(3000);
```

**Error-handling middleware** is the one with **four** parameters `(err, req, res, next)` and must be registered **last**. Anything you `throw` in an async handler you must forward with `next(err)` (or use Express 5, which auto-forwards rejected promises).

## 5c. The BFF pattern — why this layer exists at all

This is the architectural question in the whole demo, and you should have a crisp answer. **Backend-for-Frontend**: a thin server dedicated to one frontend, sitting between the browser and downstream services.

Why the reference app has one instead of letting React call FastAPI directly:

| Concern | What the BFF does | Why not in the browser |
|---|---|---|
| **CORS** | One controlled origin (the BFF) talks to the ML service server-to-server; browser only talks to the BFF | Otherwise every service needs browser-facing CORS config |
| **Not exposing the ML service** | FastAPI/PyTorch stays on a private network, no public route | You don't want a GPU inference endpoint open to the internet |
| **Auth / secrets** | BFF injects the ML service API key / internal token server-side | A key shipped to the browser is a leaked key |
| **Request shaping** | BFF can validate size/type, rename fields, add correlation IDs, set timeouts | Browser can't be trusted to enforce this |
| **Aggregation / stability** | If tomorrow analysis needs two ML calls, the BFF hides that from the frontend | Frontend contract stays stable |

The line to say: *"The frontend never talks to the ML service directly. The Express BFF owns CORS, injects the internal auth, enforces upload limits and timeouts, and forwards the multipart image server-to-server — so the PyTorch service never has a public route and the frontend has one stable, typed endpoint."* That single sentence is worth a lot in this screen.

---

# Section 6 — Multipart upload handling & proxying (the BFF core)

## 6a. Receiving the file in Node

`multipart/form-data` is how a browser sends a file. Express's JSON parser can't read it — you need **multer** (the standard middleware, disk or memory storage) or **busboy** (lower-level streaming). the reference app uses **multer with in-memory storage** because the file is small and immediately forwarded — no need to touch disk:

```js
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB cap — reject oversized uploads
});
```

`upload.single("image")` middleware parses the one file field named `image` and puts it on `req.file` (`req.file.buffer`, `.mimetype`, `.originalname`).

## 6b. Forwarding to FastAPI (the proxy)

The BFF rebuilds a multipart request and posts it to the FastAPI `/predict` endpoint, then returns the JSON to the browser. Modern Node has global `fetch` and `FormData`/`Blob`, so no extra HTTP library is needed:

```js
const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://ml-service:8000";

async function analyzeHandler(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: "no image field" });

    const form = new FormData();
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

    const mlRes = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: "POST",
      body: form,
      headers: { "x-internal-token": process.env.ML_TOKEN ?? "" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!mlRes.ok) {
      return res.status(502).json({ error: `ml service ${mlRes.status}` });
    }

    const result = await mlRes.json(); // { coveragePct, contrailCount, maskPngBase64 }
    res.json(result);
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ error: "ml timeout" });
    next(err); // hand off to error-handling middleware
  }
}
```

Points to narrate:
- **`AbortController` + `setTimeout`** gives the outbound call a **timeout** — a slow/hung ML service must not hang the BFF forever. Return **504** on abort.
- **Status-code discipline** — **400** bad input (no file), **502** the upstream ML service errored, **504** it timed out, **500** for the unexpected (via error middleware). This mapping is exactly what a senior gets right and a junior fudges into a single 500.
- **`process.env` for config** — `ML_SERVICE_URL`, `ML_TOKEN`, `FRONTEND_URL`, `PORT` all come from environment, never hardcoded. In dev they come from a `.env` file (via `dotenv` or Node's built-in `--env-file`); in Docker Compose they come from the service definition.
- **Streaming vs buffering** — here the file is small so buffering in memory is fine. Mention you'd switch to **streaming the request body straight through** (busboy → piped fetch) for large files to keep memory flat. Knowing the trade-off is the point.

---

# Section 7 — Full-stack glue

## 7a. CORS, in one clear sentence

**CORS (Cross-Origin Resource Sharing)** is the browser rule that JavaScript on origin A may only read responses from origin B if B's server sends headers allowing it. It is a **browser** enforcement, not a server-to-server one — which is *why* the BFF can call FastAPI freely (no browser involved) while the browser→BFF hop needs `cors({ origin: FRONTEND_URL })`. In dev the Vite proxy sidesteps it entirely by making everything same-origin.

## 7b. JSON vs binary, and how the image travels end to end

| Hop | Payload | Encoding |
|---|---|---|
| Browser → BFF | the raw image file | `multipart/form-data` (binary) |
| BFF → FastAPI | the same file, re-wrapped | `multipart/form-data` (binary) |
| FastAPI → BFF | coverage %, count, mask | `application/json` (mask as base64 PNG string) |
| BFF → Browser | same JSON, passed through | `application/json` |

The mask comes back **base64-encoded inside JSON** rather than as a separate binary response — simplest for a single round trip, and the frontend turns it into a `data:image/png;base64,...` URL for the canvas. Alternative you can mention: return the mask as a real binary image on a second endpoint and reference it by URL — lighter payload, more round trips. Choosing base64-in-JSON for one call is a defensible simplicity trade-off.

## 7c. Docker Compose — the three services wired together

The reference app ships a `docker-compose.yml` that runs all three tiers on one network, which is how you demo it and how the BFF resolves the ML service by name (`http://ml-service:8000`, not `localhost`):

```yaml
services:
  frontend:
    build: ./frontend        # Vite build served by nginx (or `vite preview`)
    ports: ["5173:80"]
  bff:
    build: ./bff
    environment:
      - ML_SERVICE_URL=http://ml-service:8000
      - FRONTEND_URL=http://localhost:5173
      - ML_TOKEN=${ML_TOKEN}
    ports: ["3000:3000"]
    depends_on: [ml-service]
  ml-service:
    build: ./ml-service      # FastAPI + PyTorch U-Net
    expose: ["8000"]          # internal only — no host port published
```

The detail that shows you understand it: **`ml-service` uses `expose`, not `ports`** — it's reachable *inside* the Compose network by the BFF but **not** published to the host. That is the "ML service has no public route" claim made concrete. Service discovery is by **service name** on the shared Docker network.

---

# Section 8 — Testing & quality at dev-screen level

You won't be asked to write an exhaustive test suite, but you must sound like someone who tests.

## 8a. Frontend: Vitest + React Testing Library

- **Vitest** is the test runner for Vite apps — Jest-compatible API (`describe`/`it`/`expect`), but it reuses your Vite config so no separate Babel/transform setup. (Bare **Jest** still works and is fine to mention; Vitest is the current default *for a Vite project*.)
- **React Testing Library (RTL)** tests components **the way a user uses them** — query by role/label/text, fire events, assert on what's rendered — not by poking internal state. The mantra: *"test behavior, not implementation."*

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

test("enables Analyze once a file is chosen", async () => {
  render(<UploadPanel />);
  expect(screen.getByRole("button", { name: /analyze/i })).toBeDisabled();
  const file = new File(["x"], "sky.jpg", { type: "image/jpeg" });
  await userEvent.upload(screen.getByLabelText(/file/i), file);
  expect(screen.getByRole("button", { name: /analyze/i })).toBeEnabled();
});
```

You'd **mock `fetch`** (Vitest `vi.fn()` / MSW) so the component test never hits the real BFF.

## 8b. Backend: unit-testing the handler

The BFF handler is tested by mocking `fetch` and asserting the status-code mapping (400 on no file, 502 on ML error, 504 on abort, 200 passthrough). **Supertest** against the Express app is the common tool for route-level tests. Keep it about the branching logic — that's where BFF bugs live.

## 8c. Lint / format / CI

- **ESLint** (flat config in 2026) + **Prettier** — lint catches bugs and unused vars; Prettier owns formatting so nobody argues about it. `typescript-eslint` adds type-aware rules.
- **GitHub Actions CI** — the reference app ships a workflow that on every push/PR runs, in parallel-ish jobs: **`pytest`** for the FastAPI/ML service, and **`npm ci && npm run build`** (plus lint and Vitest) for the **frontend** and the **bff**. The build step is the cheap guarantee that the TypeScript compiles and the bundle is producible before merge.

```yaml
# .github/workflows/ci.yml (shape)
jobs:
  ml-service:
    steps: [checkout, setup-python, "pip install -r requirements.txt", "pytest"]
  frontend:
    steps: [checkout, setup-node, "npm ci", "npm run lint", "npm run test", "npm run build"]
  bff:
    steps: [checkout, setup-node, "npm ci", "npm run test", "npm run build"]
```

Being able to say *"CI runs pytest on the ML service and build+lint+test on the TypeScript sides, so a PR can't merge if any tier is broken"* is exactly the quality signal a hands-on team wants.

---

# Check yourself

1. **"Walk me through the app, front to back."**
   → React+Vite+TS uploads a sky image as `FormData`; Express BFF (multer) receives it, forwards multipart to FastAPI over the internal network with a timeout and internal token; FastAPI runs the PyTorch U-Net and returns coverage %, contrail count, and a base64 mask; React renders the numbers and composites the mask on a canvas. Three tiers, wired by Docker Compose.
2. **"Why a Node BFF instead of calling the ML service straight from React?"**
   → CORS control, keeping the ML/GPU service off the public internet, injecting internal auth server-side, enforcing upload size/timeouts, and giving the frontend one stable typed endpoint. (§5c)
3. **"Why does a React effect run twice in dev?"**
   → StrictMode intentionally mounts→unmounts→remounts in development to surface missing cleanup; it's a correctness smoke test, gone in production. You fix it by making effects idempotent with proper cleanup, not by disabling StrictMode. (§1b)
4. **"Controlled vs uncontrolled — how's your file input?"**
   → File inputs are necessarily uncontrolled (you can't set their value in JS); I read the selected `File` from the change event and lift *that* into state. (§1c)
5. **"How do you model loading/error/success state?"**
   → A discriminated union with a `kind` tag, not loose booleans — the compiler forces every case and rules out impossible states. (§3c)
6. **"How does the file actually get from browser to Python?"**
   → `FormData` + `fetch` (browser sets the multipart boundary itself); multer parses it into `req.file.buffer`; BFF re-wraps as `FormData`/`Blob` and `fetch`es FastAPI. JSON comes back the other way, mask as base64. (§4, §6)
7. **"Vite over Create-React-App — why?"**
   → Native-ESM dev server + esbuild (instant startup), fast surgical HMR, Rollup production build; CRA is deprecated. Plus the dev proxy makes `/api` same-origin so no CORS in dev. (§2)
8. **"How do you keep the Node BFF from becoming a bottleneck?"**
   → Keep it I/O-only — never block the event loop; the CPU-heavy inference lives in the Python service. Use async/await, timeouts via AbortController, memory storage only because files are small (stream for large ones). (§5a, §6b)
9. **"What status codes does the BFF return and when?"**
   → 400 no/invalid file, 200 passthrough success, 502 upstream ML error, 504 ML timeout, 500 unexpected via error middleware. Not everything-is-500. (§6b)
10. **"How would you test this?"**
    → RTL + Vitest for the component (mock `fetch`, assert button enable/disable and rendered result), Supertest + mocked fetch for the BFF's status-code branches, pytest for the ML service; all gated in GitHub Actions. (§8)
11. **"Where's the typed contract between front and back?"**
    → The `AnalysisResult` type is shared/duplicated deliberately; the BFF returns exactly that JSON and the frontend types `res.json()` as it. (§3d)
12. **"How do the three services find each other?"**
    → Docker Compose network + service names; BFF reaches `http://ml-service:8000`; the ML service uses `expose` not `ports`, so it's internal-only. (§7c)

---

# Vocabulary

- *"Function components and hooks"* — never "class components," which signals stale.
- *"Rules of Hooks — top level, never conditional."*
- *"Dependency array and cleanup function."*
- *"StrictMode double-invokes effects in dev."*
- *"Uncontrolled file input, lift the `File` into state."*
- *"Discriminated union for request state."* — the senior-TS tell.
- *"Reconciliation and stable keys — never index keys."*
- *"Custom hook"* — for extracted stateful logic.
- *"Vite dev proxy, HMR, `vite build`."* — current tooling.
- *"Backend-for-Frontend (BFF)."* — own this term.
- *"Middleware chain; error-handling middleware is the four-arg one, registered last."*
- *"`multipart/form-data`; let the browser set the boundary."*
- *"multer memory storage; multer vs busboy; buffer vs stream."*
- *"`AbortController` timeout; 502 vs 504 vs 500."*
- *"`FormData` + global `fetch` in modern Node — no axios needed."*
- *"Don't block the event loop."*
- *"`expose` vs `ports` — internal-only service."*
- *"Vitest + React Testing Library — test behavior, not implementation."*
- *"ESLint flat config + Prettier."*

---

# Things to skip

- **Redux / MobX / heavy state libraries.** The demo uses local state + one custom hook; if pressed, say "for this size, `useState` + context is right; I'd reach for Zustand/Redux Toolkit only when shared cross-page state justifies it." Don't volunteer a Redux lecture.
- **Class components and legacy lifecycle methods** (`componentDidMount`, etc.). Know they existed; live in hooks.
- **React internals (fiber architecture, the scheduler).** Fascinating, irrelevant to a dev screen — "reconciliation via a virtual-DOM diff, keyed lists" is the right altitude.
- **Vue and Angular specifics.** Job specs routinely say "React *or* Vue *or* Angular" — pick one and go deep. One framework done well beats three done vaguely, and Angular DI or Vue reactivity depth you don't have is worse than none.
- **CSS frameworks / design systems.** Not what this screen tests. A little Tailwind or plain CSS is fine; don't make it the story.
- **Webpack config archaeology.** Vite abstracts it; "CRA/Webpack is what Vite replaced" is enough.
- **GraphQL, SSR/Next.js server components, RSC internals.** the reference app is a Vite SPA + Express API. Mention Next.js only as "where I've also built (personal sites)," not as this architecture.
- **Deep event-loop phase ordering (libuv timers vs check vs poll).** "Single-threaded non-blocking loop, don't block it, microtasks before macrotasks" is plenty.

---

## What backend depth buys you here, and what it doesn't

Arriving at React and Node from a backend or architecture background is a real advantage in some places and a real liability in others. Sorting which is which is most of what separates a productive refresher from a frustrating one:

| Where you're coming from | How it lands in this stack | Verdict |
|---|---|---|
| API design, contracts, status-code discipline | BFF boundaries, error mapping, where the typed contract lives | **Transfers cleanly** — and is what most frontend-first teams are missing |
| Docker / Compose / CI/CD / IaC | Wiring three services, the Compose network, the pipeline gate | **Transfers cleanly** |
| Async I/O in a threaded runtime (Java, Go) | Node's single-threaded event loop | **Transfers with a twist** — the concurrency model is genuinely different, and "don't block the loop" is a rule you have to internalise, not derive |
| Server-rendered templating experience | React's render model | **Actively misleading** — thinking in re-renders rather than in mutations takes deliberate unlearning |
| Long-lived architectural intuition | Choosing when *not* to add a layer | **Transfers, but watch it** — small apps punish over-architecture faster than large ones |
| React 19 concurrent features, Suspense-for-data, RSC | The current frontier | **Doesn't transfer** — no backend experience shortcuts this; it's new surface for everyone |

The last two rows are the ones to watch. Backend seniority makes it easy to over-build a small frontend and to assume the render model works like a request/response cycle. Neither assumption survives contact, and both are cheaper to discover in a small app you built than in a large one you inherited.
