import type { Game, GameContext, GameMeta } from "../oryn/context";
import { Session } from "./session";
import "./ui/style.css";

export const meta: GameMeta = { title: "Furnace Choir" };

export async function createGame(ctx: GameContext): Promise<Game> {
  const session = new Session(ctx);
  await session.load();
  // For the play tests of the development server.
  if (import.meta.env.DEV) Object.assign(window, { furnace: session });
  return session;
}
