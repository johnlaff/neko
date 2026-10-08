import type { Habit, HabitDayState } from "@neko/engine";
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

/**
 * The habit the method asks for, in one quiet line under Lançar: this week as seven marks and
 * the run in words. The rule and the best run sit behind a tap.
 */
export const Streak = ({ habit }: { habit: Habit }) => (
  <details className="streak">
    <summary>
      <ol className="week" aria-label="Esta semana">
        {habit.week.map((d, i) => (
          <li key={d.date} className={d.state}>
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
        {habit.editedToday && <span>Hoje já lançado</span>}
      </span>
      <IconChevron />
    </summary>
    <p>{HABIT.rule}</p>
    <p className="meta">
      {/* Missing on projections cached before it existed. */}
      {habit.lastWeek != null ? `Semana passada: ${habit.lastWeek} de 7 dias lançados. ` : ""}
      {habit.best > habit.streak ? `Melhor sequência: ${habit.best} dias. ` : ""}
      {habit.next !== null ? `Próxima marca: ${habit.next} dias.` : ""}
    </p>
  </details>
);

/** A run that just reached a mark gets one card, the day it happens and the day after. */
export const milestoneText = (m: number) => HABIT.milestones[m] ?? `${m} dias de planilha em dia.`;
