---
title: React and Node.js full-stack refresher
summary: Modern React with hooks and TypeScript, Vite, and a Node/Express backend-for-frontend that proxies a file upload to a downstream service — the idioms, the trade-offs and how to test them.
---

# React and Node.js full-stack refresher

A hands-on refresher built around one small, realistic app: a **React + Vite + TypeScript** frontend
uploads an image, a **Node.js (Express) backend-for-frontend (BFF)** proxies the multipart upload to
a **Python (FastAPI) ML service**, and the result — a few numbers and a segmentation mask — renders
back in React. Every concept below ties back to a line in an app of that shape.

Current defaults: **function components + hooks** (no classes), **Vite** (Create React App is
deprecated), **TypeScript everywhere**, **Vitest** for a Vite app, and plain **fetch** (no axios
needed).

---

## 1. Modern React: the hooks model

### Function components and the core hooks

Everything is a function component. State and side effects come from **hooks** — functions starting
with `use` that must be called at the top level of a component or custom hook, never inside
conditions or loops (the **Rules of Hooks**), so React can match them by call order.

| Hook | What it does | Example use |
|---|---|---|
| `useState` | Local state; returns `[value, setter]` | The selected file, the preview URL, the request status |
| `useEffect` | Run a side effect after render; optional cleanup | Revoking an object URL when the file changes or the component unmounts |
| `useRef` | Mutable box that survives renders without causing one; also DOM refs | A file input ref; a `<canvas>` ref |
| `useMemo` | Memoize an expensive computed value | Formatting a derived value only when the result changes |
| `useCallback` | Memoize a function identity across renders | A stable `onUpload` passed to a child |
| `useContext` | Read a value from a Context without prop-drilling | Theme, current user |

```tsx
const [file, setFile] = useState<File | null>(null);
const [status, setStatus] = useState<RequestState>({ kind: "idle" });
const inputRef = useRef<HTMLInputElement>(null);
```

A state setter **schedules** a re-render; it does not mutate the value now. When new state depends
on old state, use the **functional updater**: `setCount(c => c + 1)`, never `setCount(count + 1)` in
async code.

### Effects: dependency arrays, cleanup, and "runs twice"

`useEffect(fn, deps)` runs `fn` **after** the render commits:

- `useEffect(fn, [])` — once after mount (cleanup on unmount).
- `useEffect(fn, [a, b])` — after mount and whenever `a` or `b` changed.
- `useEffect(fn)` — after **every** render (rarely wanted).

The **cleanup function** is what the effect returns; React runs it before the next run and on
unmount. An object URL leaks memory unless revoked:

```tsx
useEffect(() => {
  if (!file) return;
  const url = URL.createObjectURL(file);
  setPreviewUrl(url);
  return () => URL.revokeObjectURL(url); // cleanup: free the blob URL
}, [file]);
```

**Why an effect runs twice in development:** since React 18, `StrictMode` deliberately mounts,
unmounts and remounts every component in development, so effects run twice on purpose. It is a smoke
test: an effect that can't run → clean up → run again cleanly has a bug (missing cleanup, double
subscription, double fetch). It does not happen in production. Fix the effect; don't disable
StrictMode.

**Don't fetch on user action in an effect.** A request triggered by a click or submit belongs in the
event handler. Effects are for synchronizing with something external — a subscription, a DOM node, a
timer.

### Controlled vs uncontrolled inputs

- **Controlled** — React state is the single source of truth; `value` comes from state and
  `onChange` writes back. Predictable, validatable.
  ```tsx
  <input value={name} onChange={e => setName(e.target.value)} />
  ```
- **Uncontrolled** — the DOM holds the value; you read it via a ref or the change event.
  `<input type="file">` is **necessarily uncontrolled** — browsers forbid setting its value — so read
  the chosen `File` from the event and lift *that* into state.

### Lifting state, composition, keys, reconciliation

- **Lifting state up** — when two siblings need the same data, move the state to their common parent
  and pass it down; the children become presentational.
- **Composition over configuration** — small components composed with `children` or render props
  rather than one giant component with twenty props.
- **Keys and reconciliation** — React diffs the new virtual DOM against the previous render and
  applies the minimal real-DOM update. Each item in a rendered list needs a **stable, unique `key`**;
  an array index breaks on reorder or filter and attaches state to the wrong row.

### Custom hooks

A **custom hook** is a function starting with `use` that calls other hooks — the standard way to
extract reusable stateful logic:

```tsx
function useImageAnalysis() {
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

### Error boundaries and Suspense

- **Error boundaries** catch render-time errors in a subtree and show a fallback instead of a blank
  screen. Still the one thing that must be a class component (or use `react-error-boundary`).
- **Suspense** shows a fallback while a child waits for lazy-loaded code (`React.lazy`) or
  Suspense-enabled data. Suspense + `React.lazy` is how a React app code-splits.

## 2. Vite

- **Native-ESM dev server + esbuild.** Instead of bundling the whole app first (the Webpack/CRA
  model), Vite serves source as native ES modules and transforms only what the browser requests.
  Startup no longer grows with app size.
- **HMR (Hot Module Replacement)** — an edited module swaps in place, component state preserved, no
  full reload.
- **Production build uses Rollup** (`vite build`) — tree-shaken, minified, code-split bundles with
  hashed filenames into `dist/`; `vite preview` serves it locally.
- **Create React App is deprecated**; the React team points to Vite or a framework.

### The dev proxy

In development the app runs on `localhost:5173` and the BFF on `localhost:3000` — different origins,
so CORS. Vite's dev proxy forwards `/api/*` to the BFF so the browser only ever sees one origin:

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

The frontend calls `fetch("/api/analyze")` with a relative path that works identically in
development (proxied) and production (same origin or a reverse proxy). It never hardcodes a backend
host.

## 3. TypeScript in React

```tsx
type ResultViewProps = { result: AnalysisResult; onReset: () => void };
function ResultView({ result, onReset }: ResultViewProps) { /* ... */ }
```

- **Props** — a `type` destructured in the signature.
- **State** — `useState` infers from the initial value; annotate when that doesn't capture the full
  type: `useState<File | null>(null)`.
- **Refs** — `useRef<HTMLInputElement>(null)`.
- **Events** — `React.<X>Event<HTMLElement>`: `ChangeEvent<HTMLInputElement>`,
  `FormEvent<HTMLFormElement>`, `MouseEvent<HTMLButtonElement>`.

### Discriminated unions for request state

Don't model an async request with loose booleans (`isLoading`, `isError`, `data`, `error`) — they
allow impossible states. Use a union tagged by `kind`:

```ts
type AnalysisResult = { coveragePct: number; objectCount: number; maskPngBase64: string };

type RequestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: AnalysisResult }
  | { kind: "error"; message: string };
```

The compiler forces every case, and inside `case "success":` `status.data` exists while `message`
does not:

```tsx
switch (status.kind) {
  case "idle":    return <Dropzone onFile={analyze} />;
  case "loading": return <Spinner label="Analyzing…" />;
  case "error":   return <ErrorBanner message={status.message} />;
  case "success": return <ResultView result={status.data} />;
}
```

### The shared API contract type

`AnalysisResult` is **the contract between the BFF and the frontend** — shared, or deliberately
duplicated. The BFF returns exactly that JSON; the frontend types `res.json()` as it.

## 4. The upload component

```tsx
function UploadPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { status, analyze } = useImageAnalysis();

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (file) analyze(file);
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="file" accept="image/*" onChange={onFileChange} />
      {previewUrl && <img src={previewUrl} alt="preview" width={320} />}
      <button type="submit" disabled={!file || status.kind === "loading"}>
        {status.kind === "loading" ? "Analyzing…" : "Analyze"}
      </button>
      {status.kind === "success" && <ResultView result={status.data} original={previewUrl} />}
      {status.kind === "error" && <p role="alert">{status.message}</p>}
    </form>
  );
}
```

- The file input is uncontrolled; the selected `File` is lifted into state.
- The preview uses `URL.createObjectURL` (cheap, no base64) and is revoked in cleanup.
- The button is disabled while loading — no double submits.
- `FormData` + `fetch` sends the file. **Never set `Content-Type` by hand** — the browser sets
  `multipart/form-data` with the correct boundary; setting it manually is a classic bug.

### Rendering a returned mask

- **Stacked `<img>`** — the original, then an absolutely-positioned transparent mask PNG on top.
  Least code.
- **`<canvas>`** — draw the original, then the mask with `globalAlpha < 1`. Pixel control over
  blending and thresholding.

```tsx
const ctx = canvas.getContext("2d")!;
ctx.drawImage(base, 0, 0);
ctx.globalAlpha = 0.5;
ctx.drawImage(mask, 0, 0);
ctx.globalAlpha = 1;
```

## 5. Node.js and Express

### The event loop

Node runs JavaScript on a **single main thread** with a **non-blocking event loop**. I/O is handed
to the OS or libuv thread pool with a callback; the main thread keeps serving other requests. Cheap
concurrency for I/O-bound work.

- **Never block the event loop.** A CPU-heavy synchronous loop (or `fs.readFileSync` in a handler)
  freezes every concurrent request. Keep Node I/O-only and push CPU-heavy work — such as model
  inference — to another service.
- **`async/await` over callbacks**; `await` reads sequentially but doesn't block the loop.
- **Microtasks vs macrotasks** — promise callbacks run before timer and I/O callbacks within a tick.

### Routing and middleware

- **Routes** — `app.post("/analyze", handler)` maps method + path to `(req, res)`.
- **Middleware** — functions `(req, res, next)` run in order; each responds or calls `next()`. CORS,
  body parsing, auth, logging and error handling are all middleware.

```js
const app = express();
app.use(express.json());
app.use(cors({ origin: FRONTEND_URL }));
app.use(requestLogger);
app.post("/analyze", upload.single("image"), analyzeHandler);
app.use(errorHandler);                // error-handling middleware (4 args) goes LAST
app.listen(3000);
```

**Error-handling middleware** has four parameters `(err, req, res, next)` and is registered last.
Async handlers forward errors with `next(err)`; Express 5 forwards rejected promises automatically.

### The Backend-for-Frontend pattern

A **BFF** is a thin server dedicated to one frontend, between the browser and downstream services.

| Concern | What the BFF does | Why not in the browser |
|---|---|---|
| **CORS** | One origin (the BFF) talks to services server-to-server | Otherwise every service needs browser-facing CORS |
| **Not exposing internal services** | The ML service stays on a private network | A GPU inference endpoint should not be on the internet |
| **Auth / secrets** | Injects internal tokens server-side | A key shipped to the browser is a leaked key |
| **Request shaping** | Validates size/type, adds correlation IDs, sets timeouts | The browser can't be trusted to enforce limits |
| **Aggregation / stability** | Hides a change to two downstream calls | The frontend contract stays stable |

## 6. Multipart upload handling and proxying

### Receiving the file

`multipart/form-data` needs **multer** (standard middleware, disk or memory storage) or **busboy**
(lower-level streaming). Memory storage suits small files forwarded at once:

```js
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // reject oversized uploads
});
```

`upload.single("image")` puts the file on `req.file` (`.buffer`, `.mimetype`, `.originalname`).

### Forwarding downstream

```js
const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://ml-service:8000";

async function analyzeHandler(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: "no image field" });

    const form = new FormData();
    form.append("file", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const mlRes = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: "POST",
      body: form,
      headers: { "x-internal-token": process.env.ML_TOKEN ?? "" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!mlRes.ok) return res.status(502).json({ error: `ml service ${mlRes.status}` });
    res.json(await mlRes.json());
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ error: "ml timeout" });
    next(err);
  }
}
```

- **`AbortController` + `setTimeout`** gives the outbound call a timeout; a hung upstream must not
  hang the BFF.
- **Status-code discipline** — **400** bad input, **502** the upstream errored, **504** it timed
  out, **500** anything unexpected (via error middleware). Not everything is a 500.
- **Config from `process.env`** — service URLs, tokens, allowed origin, port. A `.env` file (dotenv
  or `node --env-file`) in development; the service definition in Compose.
- **Buffering vs streaming** — buffering small files is fine; for large files, stream the request
  body through (busboy piped into fetch) to keep memory flat.
- Modern Node has global `fetch`, `FormData` and `Blob` — no extra HTTP library.

## 7. Full-stack glue

### CORS

**CORS** is the browser rule that script on origin A may read responses from origin B only if B
sends headers allowing it. It is **browser** enforcement, not server-to-server — which is why the
BFF can call the ML service freely while the browser → BFF hop needs `cors({ origin: FRONTEND_URL
})`. In development the Vite proxy sidesteps it.

### How the image travels

| Hop | Payload | Encoding |
|---|---|---|
| Browser → BFF | raw image | `multipart/form-data` |
| BFF → ML service | same file, re-wrapped | `multipart/form-data` |
| ML service → BFF | numbers + mask | `application/json` (mask as base64 PNG) |
| BFF → Browser | same JSON | `application/json` |

Base64-in-JSON keeps one round trip at the cost of payload size; a separate binary endpoint
referenced by URL is lighter but adds a request.

### Docker Compose

```yaml
services:
  frontend:
    build: ./frontend
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
    build: ./ml-service
    expose: ["8000"]          # internal only — no host port published
```

Services reach each other by **service name** (`http://ml-service:8000`), not `localhost`.
**`expose` vs `ports`**: `ports` publishes on the host; `expose` makes the port reachable only inside
the Compose network — how an internal service gets no public route.

## 8. Testing and quality

- **Vitest** — the test runner for Vite apps: a Jest-compatible API that reuses the Vite config.
- **React Testing Library** — test components the way a user uses them: query by role, label or
  text, fire events, assert on what renders. *Test behaviour, not implementation.*

```tsx
test("enables Analyze once a file is chosen", async () => {
  render(<UploadPanel />);
  expect(screen.getByRole("button", { name: /analyze/i })).toBeDisabled();
  const file = new File(["x"], "image.jpg", { type: "image/jpeg" });
  await userEvent.upload(screen.getByLabelText(/file/i), file);
  expect(screen.getByRole("button", { name: /analyze/i })).toBeEnabled();
});
```

- **Mock `fetch`** (`vi.fn()` or MSW) so a component test never reaches the real backend.
- **Supertest** drives the Express app in-process to assert the BFF's status-code branches (400,
  502, 504, 200) with `fetch` mocked.
- **ESLint** (flat config, `typescript-eslint` for type-aware rules) + **Prettier** for formatting.
- **Per-tier CI gate** — every push runs each tier's checks (`pytest` for the Python service; `npm
  ci`, lint, test, build for each TypeScript side), so a PR cannot merge with any tier broken.

## Out of scope for this guide

Heavy state libraries (useState + context is right for a small app; reach for Zustand or Redux
Toolkit only when shared cross-page state justifies it), class components and lifecycle methods,
React internals (fiber, scheduler), Webpack configuration, SSR / React Server Components, and deep
event-loop phase ordering.
