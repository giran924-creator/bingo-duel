import { useCallback, useEffect, useRef, useState } from "react";
import {
  Routes,
  Route,
  useNavigate,
  useLocation,
  Navigate,
} from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { api, post, ApiError } from "./api";
import { usePreferences, useSession } from "./store";
import { useText, errorText } from "./i18n";
import { Avatar, Loading, Modal, Stat } from "./components";
import {
  Home,
  Friend,
  Queue,
  Profile,
  Leaderboard,
  History,
  Settings,
  Rules,
  Admin,
} from "./pages";
import { GameScreen } from "./GameScreen";
import { unlockAudio } from "./effects";
import type {
  ClientEvents,
  ServerEvents,
  PublicUser,
} from "../../shared/types";
export let socket: Socket<ServerEvents, ClientEvents> | null = null;
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    lock = useRef(false);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.code : "SERVER_ERROR");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
export function ErrorNotice({ code }: { code: string | null }) {
  const lang = usePreferences((s) => s.settings.language);
  return code ? (
    <p className="notice error" role="alert">
      {errorText(code, lang)}
    </p>
  ) : null;
}
interface Me {
  user: PublicUser;
  isAdmin: boolean;
  liveGameId: string | null;
  queued: boolean;
  isBanned: boolean;
  banReason: string | null;
}
export function App() {
  const t = useText(),
    navigate = useNavigate(),
    location = useLocation(),
    token = useSession((s) => s.token),
    user = useSession((s) => s.user),
    connection = useSession((s) => s.connection);
  const settings = usePreferences((s) => s.settings);
  const [boot, setBoot] = useState(true),
    [dev, setDev] = useState(false),
    [bootError, setBootError] = useState<string | null>(null);
  const [player, setPlayer] = useState("1"),
    [key, setKey] = useState("");
  const action = useAction();
  const initialize = useCallback(async () => {
    setBoot(true);
    setBootError(null);
    try {
      const cfg = await api<{ devAuth: boolean }>("/config");
      setDev(cfg.devAuth);
      if (!useSession.getState().token && window.Telegram?.WebApp.initData) {
        const r = await post<{ token: string; user: PublicUser }>("/auth", {
          initData: window.Telegram.WebApp.initData,
        });
        sessionStorage.setItem("bingo-token", r.token);
        useSession.getState().set(r);
      }
      if (useSession.getState().token) {
        const me = await api<Me>("/me");
        useSession.getState().set({ user: me.user, isAdmin: me.isAdmin });
      }
    } catch (e) {
      setBootError(e instanceof ApiError ? e.code : "NETWORK");
    } finally {
      setBoot(false);
    }
  }, []);
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();
    void initialize();
  }, [initialize]);
  useEffect(() => {
    const theme = () => {
      document.documentElement.dataset.theme =
        settings.theme === "auto"
          ? (window.Telegram?.WebApp.colorScheme ?? "dark")
          : settings.theme;
    };
    theme();
    window.Telegram?.WebApp.onEvent("themeChanged", theme);
    return () => window.Telegram?.WebApp.offEvent("themeChanged", theme);
  }, [settings.theme]);
  useEffect(() => {
    if (!token) return;
    const s = io({
      auth: { token },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
    socket = s;
    s.on("connect", () => {
      useSession.getState().set({ connection: "online" });
      const g = useSession.getState().game;
      if (g) {
        s.emit("game:join", { gameId: g.id }, () => {});
        void api<typeof g>(`/games/${g.id}`)
          .then((game) => useSession.getState().set({ game }))
          .catch(() => {});
      }
    });
    s.on("disconnect", () =>
      useSession
        .getState()
        .set({ connection: navigator.onLine ? "reconnecting" : "offline" }),
    );
    s.on("connect_error", () =>
      useSession
        .getState()
        .set({ connection: navigator.onLine ? "reconnecting" : "offline" }),
    );
    s.on("game:state", (game) => {
      const previous = useSession.getState().game;
      if (
        previous &&
        previous.id === game.id &&
        game.turns.length >= previous.turns.length
      )
        useSession.getState().set({ game });
    });
    s.on("match:found", ({ gameId }) => navigate(`/game/${gameId}`));
    const offline = () => useSession.getState().set({ connection: "offline" }),
      online = () => {
        useSession.getState().set({ connection: "reconnecting" });
        s.connect();
      };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      s.disconnect();
      socket = null;
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [token, navigate]);
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(location.search);
    const start =
      params.get("tgWebAppStartParam") ??
      window.Telegram?.WebApp.initDataUnsafe?.start_param;
    const code =
      params.get("invite") ??
      (start?.startsWith("game_") ? start.slice(5) : null);
    if (code && /^[A-Z2-9]{8}$/.test(code)) {
      void post<{ gameId: string }>(`/games/${code}/join`)
        .then((r) => navigate(`/game/${r.gameId}`, { replace: true }))
        .catch((e) => {
          setBootError(e instanceof ApiError ? e.code : "NETWORK");
          navigate("/", { replace: true });
        });
    }
  }, [user?.id]); // Invitation is untrusted navigation data, never authentication.
  if (boot)
    return (
      <main className="app">
        <Brand />
        <Loading />
      </main>
    );
  if (!user)
    return (
      <main className="app auth">
        <Brand />
        <h1>{t.localTitle}</h1>
        <ErrorNotice code={bootError ?? action.error} />
        {dev ? (
          <>
            <p className="muted">{t.localHelp}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  const r = await post<{ token: string; user: PublicUser }>(
                    "/auth",
                    { devId: Number(player), devKey: key },
                  );
                  sessionStorage.setItem("bingo-token", r.token);
                  useSession.getState().set(r);
                  setKey("");
                  await initialize();
                });
              }}
            >
              <label>
                {t.playerId}
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  value={player}
                  onChange={(e) => setPlayer(e.target.value)}
                  required
                />
              </label>
              <label>
                {t.localKey}
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  required
                  autoComplete="off"
                />
              </label>
              <button className="primary" disabled={action.busy}>
                {action.busy ? t.loading : t.login}
              </button>
            </form>
          </>
        ) : (
          <>
            <p>{t.telegramOnly}</p>
            <button onClick={() => void initialize()}>{t.retry}</button>
          </>
        )}
      </main>
    );
  const gameRoute = location.pathname.startsWith("/game/");
  return (
    <main className="app" onPointerDown={unlockAudio}>
      {!gameRoute && (
        <header className="topbar">
          {location.pathname === "/" ? (
            <Brand small />
          ) : (
            <button className="back" onClick={() => navigate("/")}>
              ← {t.back}
            </button>
          )}
          <button
            className="icon-button"
            aria-label={t.profile}
            onClick={() => navigate("/profile")}
          >
            <Avatar user={user} />
          </button>
        </header>
      )}
      {connection !== "online" && (
        <div className="connection-bar">
          {connection === "offline" ? "🔴" : "🟡"} {t[connection]}
        </div>
      )}
      <ErrorNotice code={bootError} />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/friend" element={<Friend />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/game/:id" element={<GameScreen />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/stats" element={<Profile />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/rules" element={<Rules />} />
        <Route
          path="/admin"
          element={
            useSession.getState().isAdmin ? (
              <Admin />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!gameRoute && (
        <nav className="bottom-nav">
          <button
            className={location.pathname === "/" ? "selected" : ""}
            onClick={() => navigate("/")}
          >
            <span>⌂</span>
            {t.home}
          </button>
          <button
            className={location.pathname === "/leaderboard" ? "selected" : ""}
            onClick={() => navigate("/leaderboard")}
          >
            <span>♜</span>
            {t.leaderboard}
          </button>
          <button
            className={location.pathname === "/history" ? "selected" : ""}
            onClick={() => navigate("/history")}
          >
            <span>◷</span>
            {t.history}
          </button>
          <button
            className={location.pathname === "/settings" ? "selected" : ""}
            onClick={() => navigate("/settings")}
          >
            <span>⚙</span>
            {t.settings}
          </button>
        </nav>
      )}
    </main>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-icon">
        B<span>•</span>
      </span>
      <div>
        BINGO<span>DUEL</span>
      </div>
    </div>
  );
}
export { Modal, Stat };
