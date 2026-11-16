// The /projects kanban: the board's cards in four columns by whose move it is,
// worked out from what the board already returns (nothing new is stored). The
// same rules as ec's `ProjectRules` (PersonalOS-iOS, ProjectRules.swift). Pure.

import type { BoardCard, ProjectsBoard, Visibility } from "./board-model";

export type ProjectStage = "onMe" | "waiting" | "quiet" | "finished";
export const STAGES: readonly ProjectStage[] = ["onMe", "waiting", "quiet", "finished"];

export const STAGE_TITLE: Record<ProjectStage, string> = {
  onMe: "On me",
  waiting: "Waiting",
  quiet: "Quiet",
  finished: "Finished",
};

/** What an empty column says. */
export const STAGE_EMPTY: Record<ProjectStage, string> = {
  onMe: "Nothing is waiting on you.",
  waiting: "Nothing is waiting on anyone else.",
  quiet: "Nothing has gone quiet.",
  finished: "Nothing finished yet.",
};

export type ProjectColumn = { stage: ProjectStage; cards: BoardCard[] };

/**
 * The column a card sits in; null for a hidden card, which stays in its own
 * section. Finished is Eddie's call; a card the last run didn't return is Quiet;
 * one whose next step belongs to someone else is Waiting; the rest are his move.
 */
export function stageOf(card: BoardCard): ProjectStage | null {
  if (card.visibility === "hidden") return null;
  if (card.visibility === "finished") return "finished";
  if (card.stale) return "quiet";
  return card.steps[0]?.waiting === true ? "waiting" : "onMe";
}

/** All four columns, in order, each keeping the board's order (pinned first, then newest). */
export function kanban(board: Pick<ProjectsBoard, "cards" | "finished">): ProjectColumn[] {
  const cards = [...board.cards, ...board.finished];
  return STAGES.map((stage) => ({ stage, cards: cards.filter((c) => stageOf(c) === stage) }));
}

/**
 * What dropping a card on a column does: onto Finished it's marked finished, and
 * a finished card dropped anywhere else is reopened. The other three columns are
 * the inference's, so a move between them does nothing (null).
 */
export function dropVisibility(card: BoardCard, on: ProjectStage): Visibility | null {
  const from = stageOf(card);
  if (from === null || from === on) return null;
  if (on === "finished") return "finished";
  return from === "finished" ? "auto" : null;
}

/**
 * The card's next step with its lead-in: "Next:", or "Waiting on Kepler:" when
 * the move is someone else's. Null on a finished card or one with no next step.
 */
export function nextStep(card: BoardCard): { label: string; text: string } | null {
  if (card.visibility === "finished" || !card.next) return null;
  const step = card.steps[0];
  if (step?.waiting && step.who) return { label: `Waiting on ${step.who}:`, text: card.next };
  return { label: "Next:", text: card.next };
}
