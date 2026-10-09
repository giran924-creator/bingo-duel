import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, post, ApiError } from "./api";
import { useSession, usePreferences, type Locale } from "./store";
import { useText } from "./i18n";
import { useAction, ErrorNotice } from "./App";
import { Avatar, Loading, Stat } from "./components";
import type { GameView, PublicUser, StatsView } from "../../shared/types";
function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let valid = true;
    setData(null);
    setError(null);
    void api<T>(url)
      .then((r) => {
        if (valid) setData(r);
      })
      .catch((e) => {
        if (valid) setError(e instanceof ApiError ? e.code : "NETWORK");
      });
    return () => {
      valid = false;
    };
  }, [url, tick]);
  return { data, error, reload: () => setTick((n) => n + 1) };
}
export function Home() {
  const t = useText(),
    n = useNavigate(),
    u = useSession((s) => s.user)!,
    { data, error } = useLoad<{
      liveGameId: string | null;
      isBanned: boolean;
      banReason: string | null;
    }>("/me");
  return (
    <div className="screen">
      <section className="hero">
        <span className="eyebrow">01 / BINGO DUEL</span>
        <h1>{t.tagline}</h1>
        <p>{t.subtitle}</p>
        <div className="hero-balls">
          <span>17</span>
          <span>07</span>
          <span>32</span>
          <span>✓</span>
        </div>
      </section>
      <div className="player-card">
        <Avatar user={u} />
        <div>
          <strong>{u.firstName}</strong>
          <p>
            {t.level} {u.level} · {u.xp} XP
          </p>
        </div>
        <span className="rating">♜ {u.rating}</span>
      </div>
      <ErrorNotice code={error} />
      {data?.isBanned && (
        <p className="notice error">
          {t.banned} {data.banReason}
        </p>
      )}
      {data?.liveGameId && (
        <button
          className="primary full"
          onClick={() => n(`/game/${data.liveGameId}`)}
        >
          ↗ {t.resume}
        </button>
      )}
      <h2 className="eyebrow section-label">{t.play}</h2>
      <button
        className="play-card primary"
        disabled={data?.isBanned}
        onClick={() => n("/queue")}
      >
        <span className="play-icon">⚡</span>
        <span>
          <strong>{t.quick}</strong>
          <small>{t.quickSub}</small>
        </span>
        <b>→</b>
      </button>
      <button
        className="play-card"
        disabled={data?.isBanned}
        onClick={() => n("/friend")}
      >
        <span className="play-icon">♧</span>
        <span>
          <strong>{t.friend}</strong>
          <small>{t.friendSub}</small>
        </span>
        <b>→</b>
      </button>
      <div className="stats-grid">
        <Stat label={t.wins} value={u.wins} />
        <Stat label={t.games} value={u.gamesPlayed} />
        <Stat label={t.streak} value={`${u.currentWinStreak} 🔥`} />
      </div>
      <div className="link-row">
        <button onClick={() => n("/stats")}>↗ {t.stats}</button>
        <button onClick={() => n("/rules")}>? {t.rules}</button>
      </div>
      {useSession.getState().isAdmin && (
        <button className="full" onClick={() => n("/admin")}>
          {t.admin}
        </button>
      )}
    </div>
  );
}
export function Friend() {
  const t = useText(),
    n = useNavigate(),
    a = useAction(),
    [mode, setMode] = useState<"RANDOM" | "MANUAL">("RANDOM"),
    [lines, setLines] = useState(5),
    [diag, setDiag] = useState(false),
    [code, setCode] = useState("");
  return (
    <div className="screen">
      <h1>{t.friend}</h1>
      <section className="card">
        <label>
          {t.boardMode}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="RANDOM">{t.random}</option>
            <option value="MANUAL">{t.manual}</option>
          </select>
        </label>
        <label>
          {t.winLines}
          <input
            type="number"
            min="1"
            max="10"
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
          />
        </label>
        <label className="switch-row">
          {t.diagonal}
          <input
            type="checkbox"
            checked={diag}
            onChange={(e) => setDiag(e.target.checked)}
          />
        </label>
        <button
          className="primary full"
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              const r = await post<{ gameId: string }>("/games/friend", {
                boardMode: mode,
                winLines: lines,
                diagonalEnabled: diag,
              });
              n(`/game/${r.gameId}`);
            })
          }
        >
          {a.busy ? t.loading : t.create}
        </button>
      </section>
      <section className="card">
        <label>
          {t.inviteCode}
          <input
            maxLength={8}
            value={code}
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))
            }
            placeholder="AB7K9XYZ"
          />
        </label>
        <button
          className="full"
          disabled={a.busy || code.length !== 8}
          onClick={() =>
            void a.run(async () => {
              const r = await post<{ gameId: string }>(`/games/${code}/join`);
              n(`/game/${r.gameId}`);
            })
          }
        >
          {t.join}
        </button>
      </section>
      <ErrorNotice code={a.error} />
    </div>
  );
}
export function Queue() {
  const t = useText(),
    n = useNavigate(),
    a = useAction(),
    [elapsed, setElapsed] = useState(0),
    [started, setStarted] = useState(false);
  useEffect(() => {
    let valid = true;
    void post<{ gameId: string | null }>("/matchmaking/join")
      .then((r) => {
        if (!valid) return;
        if (r.gameId) n(`/game/${r.gameId}`, { replace: true });
        else setStarted(true);
      })
      .catch((e) => {
        if (valid) a.setError(e instanceof ApiError ? e.code : "NETWORK");
      });
    return () => {
      valid = false;
    };
  }, []);
  useEffect(() => {
    if (!started) return;
    const interval = setInterval(() => {
      setElapsed((v) => v + 1);
    }, 1000);
    let busy = false;
    const poll = setInterval(() => {
      if (busy) return;
      busy = true;
      void api<{ liveGameId: string | null; queued: boolean }>("/me")
        .then(async (r) => {
          if (r.liveGameId) n(`/game/${r.liveGameId}`, { replace: true });
          else if (!r.queued) {
            const q = await post<{ gameId: string | null }>(
              "/matchmaking/join",
            );
            if (q.gameId) n(`/game/${q.gameId}`, { replace: true });
          }
        })
        .catch((e) => a.setError(e instanceof ApiError ? e.code : "NETWORK"))
        .finally(() => {
          busy = false;
        });
    }, 5000);
    return () => {
      clearInterval(interval);
      clearInterval(poll);
    };
  }, [started]);
  return (
    <div className="screen queue-screen">
      <div className="radar">
        <span>♜</span>
      </div>
      <h1>{t.searching}</h1>
      <p className="timer">
        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
      </p>
      <ErrorNotice code={a.error} />
      <button
        className="full"
        disabled={a.busy}
        onClick={() =>
          void a.run(async () => {
            await api("/matchmaking", { method: "DELETE" });
            n("/");
          })
        }
      >
        {t.cancelSearch}
      </button>
    </div>
  );
}
export function Profile() {
  const t = useText(),
    { data, error, reload } = useLoad<StatsView>("/stats/me");
  useEffect(() => {
    if (data) useSession.getState().set({ user: data.user });
  }, [data]);
  if (error)
    return (
      <>
        <ErrorNotice code={error} />
        <button onClick={reload}>{t.retry}</button>
      </>
    );
  if (!data) return <Loading />;
  const u = data.user;
  return (
    <div className="screen">
      <section className="profile-head">
        <Avatar user={u} size="large" />
        <h1>{u.firstName}</h1>
        <p className="muted">{u.username ? `@${u.username}` : t.profile}</p>
        <span className="pill">
          {t.level} {u.level} · {u.xp} XP
        </span>
        <div className="xp-track">
          <div style={{ width: `${u.xp % 100}%` }} />
        </div>
      </section>
      <div className="stats-grid">
        <Stat label={t.rating} value={u.rating} />
        <Stat label={t.rank} value={`#${data.rank}`} />
        <Stat label={t.winRate} value={`${data.winRate}%`} />
        <Stat label={t.wins} value={u.wins} />
        <Stat label={t.losses} value={u.losses} />
        <Stat label={t.draws} value={u.draws} />
        <Stat label={t.games} value={u.gamesPlayed} />
        <Stat label={t.streak} value={u.currentWinStreak} />
        <Stat label={t.bestStreak} value={u.bestWinStreak} />
        <Stat label={t.totalLines} value={u.totalLines} />
        <Stat label={t.averageTurns} value={data.averageTurns} />
        <Stat
          label={t.joined}
          value={new Date(u.createdAt).toLocaleDateString()}
        />
      </div>
      <h2>{t.achievements}</h2>
      {!data.achievements.length ? (
        <p className="muted">{t.noAchievements}</p>
      ) : (
        <div className="achievement-grid">
          {data.achievements.map((a) => (
            <div className="achievement" key={a.code}>
              <span>✦</span>
              <strong>
                {t.achievementNames[
                  a.code as keyof typeof t.achievementNames
                ] ?? a.code}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
export function Leaderboard() {
  const t = useText(),
    [sort, setSort] = useState("rating"),
    { data, error, reload } = useLoad<{
      players: { rank: number; user: PublicUser }[];
      myRank: number;
    }>(`/leaderboard?sort=${sort}`),
    me = useSession((s) => s.user);
  return (
    <div className="screen">
      <h1>♜ {t.leaderboard}</h1>
      <div className="tabs">
        {["rating", "bestWinStreak", "gamesPlayed", "wins"].map((s, i) => (
          <button
            key={s}
            className={sort === s ? "selected" : ""}
            onClick={() => setSort(s)}
          >
            {[t.rating, t.streak, t.games, t.wins][i]}
          </button>
        ))}
      </div>
      <ErrorNotice code={error} />
      {error && <button onClick={reload}>{t.retry}</button>}
      {!data && !error && <Loading />}
      {data && (
        <>
          <p className="pill">
            {t.rank}: #{data.myRank}
          </p>
          <div className="list">
            {data.players.map(({ rank, user }) => (
              <div
                className={`leader-row ${me?.id === user.id ? "mine" : ""}`}
                key={user.id}
              >
                <span className="rank">
                  {rank < 4 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
                </span>
                <Avatar user={user} />
                <strong>
                  {user.firstName}
                  <small>
                    {user.wins} {t.wins}
                  </small>
                </strong>
                <b>
                  {
                    user[
                      sort as
                        "rating" | "bestWinStreak" | "gamesPlayed" | "wins"
                    ]
                  }
                </b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
export function History() {
  const t = useText(),
    n = useNavigate(),
    uid = useSession((s) => s.user)!.id,
    [page, setPage] = useState(1),
    [all, setAll] = useState<GameView[]>([]),
    { data, error, reload } = useLoad<GameView[]>(`/me/history?page=${page}`);
  useEffect(() => {
    if (data)
      setAll((old) =>
        page === 1
          ? data
          : [...old.filter((g) => !data.some((d) => d.id === g.id)), ...data],
      );
  }, [data, page]);
  return (
    <div className="screen">
      <h1>{t.history}</h1>
      <ErrorNotice code={error} />
      {error && <button onClick={reload}>{t.retry}</button>}
      {!data && !all.length && !error && <Loading />}
      {data && !all.length && (
        <p className="empty">
          ◷<br />
          {t.noHistory}
        </p>
      )}
      {all.map((g) => {
        const mine = g.players.find((p) => p.user.id === uid)!,
          opp = g.players.find((p) => p.user.id !== uid),
          won = g.winnerId === uid;
        return (
          <button
            className="history-card"
            key={g.id}
            onClick={() => n(`/game/${g.id}`)}
          >
            <span className="result-icon">
              {g.status === "CANCELLED"
                ? "—"
                : g.result === "DRAW"
                  ? "🤝"
                  : won
                    ? "🏆"
                    : "↘"}
            </span>
            <span>
              <strong>
                {g.status === "CANCELLED"
                  ? t.cancelled
                  : g.result === "DRAW"
                    ? t.draw
                    : won
                      ? t.victory
                      : t.defeat}
              </strong>
              <small>
                {opp?.user.firstName ?? t.waiting} ·{" "}
                {new Date(g.finishedAt ?? g.createdAt).toLocaleDateString()}
              </small>
            </span>
            <span>
              <b>
                {mine.lineCount}–{opp?.lineCount ?? 0}
              </b>
              <small
                className={
                  (mine.ratingDelta ?? 0) >= 0 ? "positive" : "negative"
                }
              >
                {(mine.ratingDelta ?? 0) > 0 ? "+" : ""}
                {mine.ratingDelta ?? 0}
              </small>
            </span>
          </button>
        );
      })}
      {data?.length === 20 && (
        <button className="full" onClick={() => setPage((p) => p + 1)}>
          {t.more}
        </button>
      )}
    </div>
  );
}
export function Settings() {
  const t = useText(),
    s = usePreferences((v) => v.settings),
    update = usePreferences((v) => v.update);
  return (
    <div className="screen">
      <h1>{t.settings}</h1>
      <section className="card">
        {(["sound", "haptic", "confirmNumber"] as const).map((k, i) => (
          <label className="switch-row" key={k}>
            {[t.sound, t.haptic, t.numberConfirmation][i]}
            <input
              type="checkbox"
              checked={s[k]}
              onChange={(e) => update({ [k]: e.target.checked })}
            />
          </label>
        ))}
        <label>
          {t.language}
          <select
            value={s.language}
            onChange={(e) => update({ language: e.target.value as Locale })}
          >
            <option value="uz">O‘zbekcha</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {t.theme}
          <select
            value={s.theme}
            onChange={(e) =>
              update({ theme: e.target.value as typeof s.theme })
            }
          >
            <option value="auto">{t.auto}</option>
            <option value="dark">{t.dark}</option>
            <option value="light">{t.light}</option>
          </select>
        </label>
      </section>
      <button
        className="full"
        onClick={() => {
          sessionStorage.removeItem("bingo-token");
          useSession.getState().set({ token: null, user: null, game: null });
        }}
      >
        {t.logout}
      </button>
    </div>
  );
}
export function Rules() {
  const t = useText();
  return (
    <div className="screen">
      <h1>{t.rules}</h1>
      <ol className="rules-list">
        {t.rulesText.map((text, i) => (
          <li key={i}>
            <span>{i + 1}</span>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
interface AdminData {
  users: number;
  online: number;
  active: number;
  completed: number;
  today: number;
  queue: number;
  dailyActive: number;
  completedToday: number;
  quickToday: number;
  friendToday: number;
  averageSeconds: number;
  recentUsers: (PublicUser & { isBanned: boolean; banReason: string | null })[];
  recentGames: {
    id: string;
    publicCode: string;
    status: string;
    type: string;
  }[];
}
export function Admin() {
  const t = useText(),
    { data, error, reload } = useLoad<AdminData>("/admin"),
    a = useAction(),
    [view, setView] = useState<GameView | null>(null);
  if (!data)
    return (
      <>
        <ErrorNotice code={error} />
        {!error && <Loading />}
      </>
    );
  return (
    <div className="screen">
      <h1>{t.admin}</h1>
      <ErrorNotice code={error ?? a.error} />
      <button onClick={reload}>{t.retry}</button>
      <div className="stats-grid">
        {(
          [
            "users",
            "online",
            "active",
            "completed",
            "today",
            "queue",
            "dailyActive",
          ] as const
        ).map((k) => (
          <Stat key={k} label={t[k]} value={data[k]} />
        ))}
        <Stat label={t.quick} value={data.quickToday} />
        <Stat label={t.friend} value={data.friendToday} />
        <Stat
          label={`${t.duration} (${t.seconds})`}
          value={data.averageSeconds}
        />
      </div>
      <h2>{t.recentUsers}</h2>
      {data.recentUsers.map((u) => (
        <div className="admin-row" key={u.id}>
          <Avatar user={u} />
          <strong>{u.firstName}</strong>
          <button
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                const reason = u.isBanned ? "" : prompt(t.banReason);
                if (reason === null) return;
                await post(`/admin/users/${u.id}/ban`, {
                  isBanned: !u.isBanned,
                  reason,
                });
                reload();
              })
            }
          >
            {u.isBanned ? t.unban : t.ban}
          </button>
        </div>
      ))}
      <h2>{t.recentGames}</h2>
      {data.recentGames.map((g) => (
        <div className="admin-row" key={g.id}>
          <span>
            {g.publicCode}
            <small>{g.status}</small>
          </span>
          <button
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                setView(await api<GameView>(`/admin/games/${g.id}`));
              })
            }
          >
            {t.view}
          </button>
          {["WAITING", "ACTIVE", "PAUSED"].includes(g.status) && (
            <button
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  if (!confirm(t.cancelGame)) return;
                  await post(`/admin/games/${g.id}/cancel`);
                  reload();
                })
              }
            >
              ×
            </button>
          )}
        </div>
      ))}
      {view && (
        <section className="card">
          <h2>{view.publicCode}</h2>
          <p>
            {view.status} · {view.turns.length} {t.turns}
          </p>
          {view.players.map((p) => (
            <p key={p.id}>
              {p.user.firstName}: {p.lineCount}
            </p>
          ))}
          <button onClick={() => setView(null)}>{t.close}</button>
        </section>
      )}
    </div>
  );
}
