export type GameStatus =
  "WAITING" | "ACTIVE" | "PAUSED" | "FINISHED" | "CANCELLED";
export type GameType = "FRIEND" | "QUICK";
export type BoardMode = "RANDOM" | "MANUAL";
export type GameResult = "WIN" | "DRAW" | "FORFEIT" | "ABANDONED";
export interface PublicUser {
  id: string;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  rating: number;
  xp: number;
  level: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  currentWinStreak: number;
  bestWinStreak: number;
  totalLines: number;
  totalTurns: number;
  createdAt: string;
}
export interface PlayerView {
  id: string;
  user: PublicUser;
  seat: number;
  isReady: boolean;
  lineCount: number;
  online: boolean;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  board?: number[];
  completedLines: string[];
}
export interface TurnView {
  number: number;
  turnIndex: number;
  userId: string;
  createdAt: string;
}
export interface GameView {
  id: string;
  publicCode: string;
  type: GameType;
  boardMode: BoardMode;
  status: GameStatus;
  numberMin: number;
  numberMax: number;
  boardSize: number;
  winLines: number;
  diagonalEnabled: boolean;
  currentPlayerId: string | null;
  firstPlayerId: string | null;
  winnerId: string | null;
  result: GameResult | null;
  rulesVersion: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  turnDeadline: string | null;
  players: PlayerView[];
  turns: TurnView[];
  rematchRequestedBy: string | null;
  rematchGameId: string | null;
  inviteUrl: string | null;
}
export interface Ack {
  ok: boolean;
  error?: string;
  gameId?: string;
}
export interface ClientEvents {
  "game:join": (
    payload: { gameId: string },
    ack: (result: Ack) => void,
  ) => void;
  "game:ready": (
    payload: { gameId: string; cells?: number[] },
    ack: (result: Ack) => void,
  ) => void;
  "game:call-number": (
    payload: { gameId: string; number: number },
    ack: (result: Ack) => void,
  ) => void;
  "game:rematch-request": (
    payload: { gameId: string },
    ack: (result: Ack) => void,
  ) => void;
  "game:rematch-response": (
    payload: { gameId: string; accept: boolean },
    ack: (result: Ack) => void,
  ) => void;
}
export interface ServerEvents {
  "game:state": (game: GameView) => void;
  "match:found": (payload: { gameId: string }) => void;
  error: (payload: { message: string }) => void;
}
export interface StatsView {
  user: PublicUser;
  rank: number;
  winRate: number;
  averageTurns: number;
  achievements: { code: string; unlockedAt: string }[];
}
