import type { Habit, HabitDayState } from "@neko/engine";
import { useState } from "react";
import { dismissHint, hintSeen } from "./Hint.tsx";
import { IconChevron } from "./icons.tsx";
import { HABIT, streakLabel } from "./learn.ts";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"] as const;
const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const STATE_LABEL: Record<HabitDayState, string> = {
  edited: "lançado",
  rest: "folga",
  missed: "sem lançar",
  today: "hoje, em aberto",
  future: "ainda não chegou",
};

const LEGEND = [
  ["edited", "Lançado"],
  ["rest", "Folga"],
  ["missed", "Sem lançar"],
] as const;

/**
 * The habit the method asks for, in one quiet line under Lançar: this week as seven marks and
 * the run in words. The rule, the legend and the best run sit behind a tap.
 */
export const Streak = ({ habit }: { habit: Habit }) => {
  // Open on the first visit, so the marks are read once with their legend; closed from then on.
  const [open, setOpen] = useState(() => !hintSeen("streak"));
  return (
    <details
      className="streak"
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) dismissHint("streak");
      }}
    >
      <summary>
        <ol className="week" aria-label="Esta semana">
          {habit.week.map((d, i) => (
            <li
              key={d.date}
              className={d.state}
              title={`${WEEKDAY_NAMES[i]}: ${STATE_LABEL[d.state]}`}
            >
              <span className="mark" aria-hidden="true" />
              <span aria-hidden="true">{WEEKDAYS[i]}</span>
              <span className="sr-only">
                {WEEKDAY_NAMES[i]}: {STATE_LABEL[d.state]}
              </span>
            </li>
          ))}
        </ol>
        <span className="streak-text">
          <strong>{streakLabel(habit.streak)}</strong>
          {/* A mark or a new best run is a word on this line, not a card of its own. */}
          {habit.milestone != null ? (
            <span>{milestoneText(habit.milestone)}</span>
          ) : habit.record != null ? (
            <span>Novo recorde</span>
          ) : (
            habit.editedToday && <span>Hoje já lançado</span>
          )}
        </span>
        <IconChevron />
      </summary>
      <p>{HABIT.rule}</p>
      {/* The marks explained once, in the marks themselves, so the row needs no memory. */}
      <ul className="week-legend" aria-hidden="true">
        {LEGEND.map(([state, label]) => (
          <li key={state} className={state}>
            <span className="mark" />
            {label}
          </li>
        ))}
      </ul>
      <p className="meta">
        {/* Missing on projections cached before it existed. */}
        {habit.lastWeek != null ? `Semana passada: ${habit.lastWeek} de 7 dias lançados. ` : ""}
        {habit.best > habit.streak ? `Melhor sequência: ${habit.best} dias. ` : ""}
        {habit.next !== null ? `Próxima marca: ${habit.next} dias.` : ""}
      </p>
    </details>
  );
};

/** What a mark means, on the habit line the day it lands and the day after. */
export const milestoneText = (m: number) => HABIT.milestones[m] ?? `${m} dias de planilha em dia.`;
