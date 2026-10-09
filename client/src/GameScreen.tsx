import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession, usePreferences } from "./store";
import { useText } from "./i18n";
import { api, post, ApiError } from "./api";
import { socket, useAction, ErrorNotice } from "./App";
import { Avatar, Bingo, Board, Modal, Loading, Stat } from "./components";
import { feedback } from "./effects";
import type { GameView, StatsView } from "../../shared/types";
export function GameScreen() {
  const { id } = useParams(),
    n = useNavigate(),
    t = useText(),
    user = useSession((s) => s.user)!,
    stored = useSession((s) => s.game),
    connection = useSession((s) => s.connection),
    settings = usePreferences((s) => s.settings),
    a = useAction();
  const game = stored?.id === id ? stored : null;
  const [now, setNow] = useState(Date.now()),
    [loadError, setLoadError] = useState<string | null>(null),
    [cells, setCells] = useState<number[]>([]),
    [confirmNumber, setConfirmNumber] = useState<number | null>(null),
    [reveal, setReveal] = useState(false),
    [history, setHistory] = useState(false),
    [copied, setCopied] = useState(false),
    [achievements, setAchievements] = useState<string[]>([]);
  const previous = useRef<GameView | null>(null);
  useEffect(() => {
    let valid = true;
    setLoadError(null);
    setCells([]);
    setReveal(false);
    setAchievements([]);
    previous.current = null;
    useSession.getState().set({ game: null });
    const refresh = () =>
      api<GameView>(`/games/${id}`)
        .then((g) => {
          if (valid) {
            const old = useSession.getState().game;
            if (old?.id !== g.id || old.turns.length <= g.turns.length)
              useSession.getState().set({ game: g });
          }
        })
        .catch((e) => {
          if (valid) setLoadError(e instanceof ApiError ? e.code : "NETWORK");
        });
    void refresh();
    if (socket?.connected) socket.emit("game:join", { gameId: id! }, () => {});
    const poll = setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      valid = false;
      clearInterval(poll);
    };
  }, [id]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!game) return;
    const old = previous.current,
      mine = game.players.find((p) => p.user.id === user.id)!;
    if (old?.id === game.id) {
      if (game.status === "FINISHED" && old.status !== "FINISHED") {
        feedback(
          game.winnerId === user.id
            ? "win"
            : game.result === "DRAW"
              ? "line"
              : "lose",
        );
        void api<StatsView>("/stats/me")
          .then((p) => {
            useSession.getState().set({ user: p.user });
            if (
              game.finishedAt &&
              Date.now() - new Date(game.finishedAt).getTime() < 60000
            )
              setAchievements(
                p.achievements
                  .filter(
                    (ach) =>
                      new Date(ach.unlockedAt).getTime() >=
                      new Date(game.finishedAt!).getTime() - 2000,
                  )
                  .map((ach) => ach.code),
              );
          })
          .catch(() => {});
      } else if (
        mine.lineCount >
        (old.players.find((p) => p.user.id === user.id)?.lineCount ?? 0)
      )
        feedback("line");
      else if (
        game.currentPlayerId === user.id &&
        old.currentPlayerId !== user.id
      )
        feedback("turn");
      else if (game.turns.length > old.turns.length) feedback("select");
    }
    previous.current = game;
  }, [game, user.id]);
  useEffect(() => {
    const live = game?.status === "ACTIVE" || game?.status === "PAUSED";
    const tg = window.Telegram?.WebApp;
    if (live) tg?.enableClosingConfirmation?.();
    else tg?.disableClosingConfirmation?.();
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    if (live) window.addEventListener("beforeunload", prevent);
    return () => {
      tg?.disableClosingConfirmation?.();
      window.removeEventListener("beforeunload", prevent);
    };
  }, [game?.status]);
  if (!game)
    return (
      <div className="screen">
        <ErrorNotice code={loadError} />
        {loadError ? (
          <button onClick={() => n("/")}>{t.home}</button>
        ) : (
          <Loading />
        )}
      </div>
    );
  const me = game.players.find((p) => p.user.id === user.id)!,
    opponent = game.players.find((p) => p.user.id !== user.id),
    called = game.turns.map((turn) => turn.number),
    finished = game.status === "FINISHED",
    cancelled = game.status === "CANCELLED",
    live = game.status === "ACTIVE" || game.status === "PAUSED";
  const countdown = game.startedAt
    ? Math.max(0, Math.ceil((new Date(game.startedAt).getTime() - now) / 1000))
    : 0;
  const canCall =
    game.status === "ACTIVE" &&
    game.currentPlayerId === user.id &&
    connection === "online" &&
    !a.busy &&
    !countdown;
  const numbers = Array.from(
    { length: game.numberMax - game.numberMin + 1 },
    (_, i) => game.numberMin + i,
  );
  const act = (path: string, data: unknown = {}) =>
    a.run(async () => {
      const r = await post<{ gameId: string }>(
        `/games/${game.id}/${path}`,
        data,
      );
      const g = await api<GameView>(`/games/${game.id}`);
      useSession.getState().set({ game: g });
      return r;
    });
  const choose = (number: number) => {
    if (!canCall) return;
    if (settings.confirmNumber) setConfirmNumber(number);
    else void act("call", { number });
  };
  const back = () => {
    if (live && !window.confirm(t.leaveConfirm)) return;
    n("/");
  };
  const duration = Math.max(
    0,
    Math.round(
      ((game.finishedAt ? new Date(game.finishedAt).getTime() : now) -
        (game.startedAt ? new Date(game.startedAt).getTime() : now)) /
        1000,
    ),
  );
  const outcome = cancelled
    ? t.cancelled
    : game.result === "DRAW"
      ? t.draw
      : game.winnerId === user.id
        ? t.victory
        : t.defeat;
  return (
    <div className="screen game-screen">
      <header className="game-header">
        <button className="icon-button" onClick={back} aria-label={t.back}>
          ←
        </button>
        <div>
          <strong>{opponent?.user.firstName ?? t.waiting}</strong>
          <small>
            {opponent?.online ? "🟢 " + t.online : "🔴 " + t.offline}
          </small>
        </div>
        <span className="pill">{game.publicCode}</span>
      </header>
      <ErrorNotice code={a.error} />
      {game.status === "WAITING" ? (
        <>
          <section className="lobby-card">
            <span className="eyebrow">BINGO DUEL / {t.friend}</span>
            <h1>{t.inviteTitle}</h1>
            <div className="invite-code">{game.publicCode}</div>
            <div className="button-row">
              <button
                disabled={!game.inviteUrl}
                onClick={() => {
                  if (!game.inviteUrl) return;
                  const link = `https://t.me/share/url?url=${encodeURIComponent(game.inviteUrl)}&text=${encodeURIComponent("BINGO DUEL")}`;
                  if (window.Telegram?.WebApp)
                    window.Telegram.WebApp.openTelegramLink(link);
                  else if (navigator.share)
                    void navigator
                      .share({ title: "BINGO DUEL", url: game.inviteUrl })
                      .catch(() => {});
                  else window.open(link, "_blank", "noopener,noreferrer");
                }}
              >
                {t.share} ↗
              </button>
              <button
                onClick={() =>
                  void a.run(async () => {
                    await navigator.clipboard.writeText(game.publicCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                }
              >
                {copied ? t.copied : t.inviteCopy}
              </button>
            </div>
            <div className="lobby-players">
              {[me, opponent].map((p, i) => (
                <div key={i}>
                  {p ? (
                    <Avatar user={p.user} />
                  ) : (
                    <span className="avatar ghost">?</span>
                  )}
                  <strong>{p?.user.firstName ?? t.waiting}</strong>
                  <small className={p?.isReady ? "positive" : "muted"}>
                    {p?.isReady ? "✓ " + t.readyDone : t.waiting}
                  </small>
                </div>
              ))}
            </div>
            {!opponent && <p className="muted">{t.waitingFriend}</p>}
            <div className="lobby-settings">
              <span>{game.boardMode === "RANDOM" ? t.random : t.manual}</span>
              <span>
                {game.winLines} {t.line}
              </span>
              <span>
                {t.diagonal}: {game.diagonalEnabled ? t.on : t.off}
              </span>
            </div>
          </section>
          {game.boardMode === "MANUAL" && !me.isReady ? (
            <section className="card">
              <p>{t.manualHelp}</p>
              <div className="board">
                {Array.from({ length: 25 }, (_, i) => (
                  <div className="cell" key={i}>
                    {cells[i] ?? "·"}
                  </div>
                ))}
              </div>
              <p className="muted">{cells.length} / 25</p>
              <div className="number-picker">
                {numbers.map((num) => (
                  <button
                    key={num}
                    className={cells.includes(num) ? "called" : ""}
                    disabled={cells.includes(num) || cells.length === 25}
                    onClick={() => setCells((c) => [...c, num])}
                  >
                    {num}
                  </button>
                ))}
              </div>
              <button
                disabled={!cells.length}
                onClick={() => setCells((c) => c.slice(0, -1))}
              >
                {t.undo}
              </button>
            </section>
          ) : (
            me.board && (
              <>
                <h2 className="eyebrow">{t.yourBoard}</h2>
                <Board cells={me.board} called={[]} />
              </>
            )
          )}
          <button
            className="primary full"
            disabled={
              a.busy ||
              me.isReady ||
              (game.boardMode === "MANUAL" && cells.length !== 25) ||
              connection !== "online"
            }
            onClick={() =>
              void act("ready", game.boardMode === "MANUAL" ? { cells } : {})
            }
          >
            {me.isReady ? "✓ " + t.readyDone : t.ready}
          </button>
          <button
            className="text-button full"
            disabled={a.busy}
            onClick={() => {
              if (confirm(t.cancelGame)) void act("leave");
            }}
          >
            {t.cancelGame}
          </button>
        </>
      ) : (
        <>
          {(finished || cancelled) && (
            <section
              className={`result-card ${game.winnerId === user.id ? "win" : ""}`}
            >
              <span className="result-emblem">
                {cancelled
                  ? "—"
                  : game.result === "DRAW"
                    ? "🤝"
                    : game.winnerId === user.id
                      ? "🏆"
                      : "↘"}
              </span>
              <h1>{outcome}</h1>
              <div className="stats-grid">
                <Stat label={t.turns} value={called.length} />
                <Stat
                  label={t.duration}
                  value={`${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`}
                />
                <Stat
                  label={t.rating}
                  value={`${(me.ratingDelta ?? 0) > 0 ? "+" : ""}${me.ratingDelta ?? 0}`}
                />
              </div>
              {game.winnerId === user.id && (
                <div className="confetti" aria-hidden="true">
                  ✦ · ✧ · ✦ · ✧
                </div>
              )}
            </section>
          )}
          <section className="score-card">
            <div className="score-row">
              <span>
                {t.you}{" "}
                <b>
                  {me.lineCount}/{game.winLines}
                </b>
              </span>
              <Bingo count={me.lineCount} target={game.winLines} />
            </div>
            <div className="score-row opponent">
              <span>
                {opponent?.user.firstName ?? t.opponent}{" "}
                <b>
                  {opponent?.lineCount ?? 0}/{game.winLines}
                </b>
              </span>
              <Bingo count={opponent?.lineCount ?? 0} target={game.winLines} />
            </div>
          </section>
          {game.status === "PAUSED" && <p className="notice">{t.paused}</p>}
          <div className="section-head">
            <h2 className="eyebrow">{t.yourBoard}</h2>
            {live && (
              <span className={`turn-pill ${canCall ? "my-turn" : ""}`}>
                {game.currentPlayerId === user.id ? t.yourTurn : t.theirTurn}
                {game.turnDeadline &&
                  ` · ${Math.max(0, Math.ceil((new Date(game.turnDeadline).getTime() - now) / 1000))}`}
              </span>
            )}
          </div>
          {me.board && (
            <Board
              cells={me.board}
              called={called}
              lines={me.completedLines}
              size={game.boardSize}
            />
          )}
          {live && (
            <>
              <div className="section-head called-history">
                <div>
                  <small>{t.lastNumber}</small>
                  <strong>{called.at(-1) ?? "—"}</strong>
                </div>
                <div className="history-chips">
                  {called
                    .slice(-5)
                    .reverse()
                    .map((v) => (
                      <span key={v}>{v}</span>
                    ))}
                </div>
                <button
                  className="icon-button"
                  onClick={() => setHistory(true)}
                  aria-label={t.calledNumbers}
                >
                  ◷
                </button>
              </div>
              <h2 className="eyebrow">{t.chooseNumber}</h2>
              <div className="number-picker">
                {numbers.map((num) => (
                  <button
                    key={num}
                    disabled={!canCall || called.includes(num)}
                    className={called.includes(num) ? "called" : ""}
                    aria-label={`${num}${called.includes(num) ? " ✓" : ""}`}
                    onClick={() => choose(num)}
                  >
                    {num}
                    {called.includes(num) && <small>✓</small>}
                  </button>
                ))}
              </div>
              <button
                className="text-button full danger"
                disabled={a.busy}
                onClick={() => {
                  if (confirm(t.surrenderConfirm)) void act("leave");
                }}
              >
                {t.surrender}
              </button>
            </>
          )}
          {finished && (
            <>
              {achievements.length > 0 && (
                <div className="achievement-toast">
                  ✦ {t.achievements}
                  <br />
                  {achievements.map((code) => (
                    <strong key={code}>
                      {t.achievementNames[
                        code as keyof typeof t.achievementNames
                      ] ?? code}
                    </strong>
                  ))}
                </div>
              )}
              {game.rematchGameId ? (
                <button
                  className="primary full"
                  onClick={() => n(`/game/${game.rematchGameId}`)}
                >
                  {t.rematch} →
                </button>
              ) : game.rematchRequestedBy &&
                game.rematchRequestedBy !== user.id ? (
                <section className="card">
                  <p>{t.rematchRequest}</p>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={a.busy}
                      onClick={() =>
                        void a.run(async () => {
                          const r = await post<{ gameId: string }>(
                            `/games/${game.id}/rematch-response`,
                            { accept: true },
                          );
                          n(`/game/${r.gameId}`);
                        })
                      }
                    >
                      {t.accept}
                    </button>
                    <button
                      disabled={a.busy}
                      onClick={() =>
                        void act("rematch-response", { accept: false })
                      }
                    >
                      {t.decline}
                    </button>
                  </div>
                </section>
              ) : (
                <button
                  className="primary full"
                  disabled={a.busy || game.rematchRequestedBy === user.id}
                  onClick={() => void act("rematch")}
                >
                  {game.rematchRequestedBy === user.id
                    ? t.rematchWaiting
                    : "↻ " + t.rematch}
                </button>
              )}
              <button className="full" onClick={() => setReveal((v) => !v)}>
                {t.reveal} {reveal ? "↑" : "↓"}
              </button>
              {reveal && opponent?.board && (
                <>
                  <h2 className="eyebrow">{t.opponentBoard}</h2>
                  <Board
                    cells={opponent.board}
                    called={called}
                    lines={opponent.completedLines}
                  />
                </>
              )}
              <button className="full" onClick={() => setHistory(true)}>
                {t.result}
              </button>
            </>
          )}
          {(finished || cancelled) && (
            <button className="text-button full" onClick={() => n("/")}>
              {t.home}
            </button>
          )}
        </>
      )}
      {countdown > 0 && (
        <div className="countdown" aria-live="assertive">
          <span key={countdown}>{countdown}</span>
          <p>BINGO DUEL</p>
        </div>
      )}
      {confirmNumber !== null && (
        <Modal
          title={t.chooseConfirm.replace("{n}", String(confirmNumber))}
          onClose={() => setConfirmNumber(null)}
        >
          <div className="chosen-number">{confirmNumber}</div>
          <div className="button-row">
            <button onClick={() => setConfirmNumber(null)}>{t.cancel}</button>
            <button
              className="primary"
              disabled={!canCall}
              onClick={() => {
                const num = confirmNumber;
                setConfirmNumber(null);
                void act("call", { number: num });
              }}
            >
              {t.confirm}
            </button>
          </div>
        </Modal>
      )}
      {history && (
        <Modal title={t.calledNumbers} onClose={() => setHistory(false)}>
          <div className="number-picker history-picker">
            {numbers.map((num) => (
              <span className={called.includes(num) ? "called" : ""} key={num}>
                {num}
                {called.includes(num) ? " ✓" : ""}
              </span>
            ))}
          </div>
          <ol className="turn-list">
            {game.turns.map((turn) => (
              <li key={turn.turnIndex}>
                <small>#{turn.turnIndex}</small>
                <strong>{turn.number}</strong>
                <span>
                  {turn.userId === user.id ? t.you : opponent?.user.firstName}
                </span>
                <small>{new Date(turn.createdAt).toLocaleTimeString()}</small>
              </li>
            ))}
          </ol>
        </Modal>
      )}
    </div>
  );
}
