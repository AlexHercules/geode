// Calendar right-sidebar pane (R43): a self-drawn month grid; click a day to
// open/create its daily note; days with notes are dotted, today highlighted.
// Contract: docs/ARCHITECTURE.md "Round 43 additions".
// Layering: features/ may import only @core/*, @app/AppContext, @app/icons.
import { useMemo, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { locale, useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { dailyNotePath, monthGrid, openOrCreateDailyNote, sameDay } from "@core/dailyNote";

import "./calendar.css";

export function CalendarPanel() {
  const app = useApp();
  const t = useI18n();
  useStore(app.vault.tree); // re-render when files appear/disappear
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), month0: today.getMonth() });

  const weeks = useMemo(() => monthGrid(view.year, view.month0), [view.year, view.month0]);
  // Intl locale follows the app's i18n locale Store (useI18n above subscribes →
  // re-renders on switch), not a raw localStorage read, so labels match the UI
  // language even on first run / navigator-detected zh (R43 review fix).
  const intlLocale = useStore(locale) === "zh" ? "zh-CN" : "en-US";
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(new Date(view.year, view.month0, 1)),
    [intlLocale, view.year, view.month0],
  );
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i))); // 2023-01-01 = Sunday
  }, [intlLocale]);

  const shift = (delta: number) => setView((v) => {
    const m = v.month0 + delta;
    return { year: v.year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 };
  });
  const goToday = () => setView({ year: today.getFullYear(), month0: today.getMonth() });

  return (
    <div className="calendar-panel" data-testid="calendar-panel">
      <div className="calendar-header">
        <button className="calendar-nav" aria-label={t("calendar.prevMonth")} data-testid="calendar-prev" onClick={() => shift(-1)}><Icon name="chevron-down" size={14} /></button>
        <span className="calendar-title" data-testid="calendar-title">{monthLabel}</span>
        <button className="calendar-nav" aria-label={t("calendar.nextMonth")} data-testid="calendar-next" onClick={() => shift(1)}><Icon name="chevron-down" size={14} /></button>
        <button className="calendar-today-btn" data-testid="calendar-today" onClick={goToday}>{t("calendar.today")}</button>
      </div>
      <div className="calendar-grid">
        {weekdays.map((w) => (<div key={w} className="calendar-weekday">{w}</div>))}
        {weeks.flat().map((cell) => {
          const inMonth = cell.getMonth() === view.month0;
          const isToday = sameDay(cell, today);
          const hasNote = app.vault.fileExists(dailyNotePath(cell));
          const cls = "calendar-day" + (inMonth ? "" : " is-outside") + (isToday ? " is-today" : "") + (hasNote ? " has-note" : "");
          return (
            <button
              key={cell.toISOString()}
              className={cls}
              data-testid={hasNote ? "calendar-day-hasnote" : "calendar-day"}
              data-day={cell.getDate()}
              onClick={() => void openOrCreateDailyNote(app.vault, app.workspace, cell)}
            >
              {cell.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
