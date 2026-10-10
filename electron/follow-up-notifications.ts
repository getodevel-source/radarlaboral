export type DueFollowUpReminder = { id: string; followUpDate: string }

export type FollowUpReminderNotice = { title: string; body: string }

export function windowsToastSettingAllowsNotifications(registryOutput: string | null): boolean {
  if (registryOutput === null) return true
  const match = registryOutput.match(/ToastEnabled\s+REG_DWORD\s+0x([\da-f]+)/iu)
  return match ? Number.parseInt(match[1], 16) !== 0 : true
}

type FollowUpDatabase = {
  listDueFollowUps(today: string): DueFollowUpReminder[]
  markFollowUpRemindersNotified(reminders: readonly DueFollowUpReminder[], today: string): number
}

export type FollowUpReminderReporter = {
  log: (error: unknown) => void
  isSupported: () => boolean
  show: (
    notice: FollowUpReminderNotice,
    onClick: () => void,
    onShown: () => void,
    onFailure: (error: unknown) => void,
  ) => void
  onClick: (count: number) => void
  fallback: (count: number, onShown: () => void) => boolean
}

export function followUpReminderNotice(count: number): FollowUpReminderNotice | null {
  if (!Number.isInteger(count) || count < 1) return null
  return {
    title: 'Tenés seguimientos pendientes',
    body: count === 1
      ? 'Llegó la fecha para retomar una postulación. Abrí Radar Laboral para revisarla.'
      : `Llegó la fecha para retomar ${count} postulaciones. Abrí Radar Laboral para revisarlas.`,
  }
}

export function reportFollowUpReminder(
  count: number,
  reporter: FollowUpReminderReporter,
  onDelivered: () => void = () => {},
): boolean {
  const notice = followUpReminderNotice(count)
  if (!notice) return false

  const log = (error: unknown) => {
    try {
      reporter.log(error)
    } catch {
      // Logging must not prevent the local fallback.
    }
  }
  const showFallback = () => {
    try {
      const shown = reporter.fallback(count, onDelivered)
      if (shown) onDelivered()
      return shown
    } catch (error) {
      log(error)
      return false
    }
  }

  let supported = false
  try {
    supported = reporter.isSupported()
  } catch (error) {
    log(error)
  }
  if (!supported) return showFallback()

  try {
    reporter.show(
      notice,
      () => reporter.onClick(count),
      onDelivered,
      (error) => {
        log(error)
        showFallback()
      },
    )
    return true
  } catch (error) {
    log(error)
    return showFallback()
  }
}

export function deliverDueFollowUpReminders(
  database: FollowUpDatabase,
  today: string,
  reporter: FollowUpReminderReporter,
): number {
  const reminders = database.listDueFollowUps(today)
  if (!reminders.length) return 0

  let marked = 0
  let delivered = false
  const markDelivered = () => {
    if (delivered) return
    try {
      marked = database.markFollowUpRemindersNotified(reminders, today)
      delivered = true
    } catch (error) {
      try {
        reporter.log(error)
      } catch {
        // A failed marker write must leave the reminder eligible for retry.
      }
    }
  }

  reportFollowUpReminder(reminders.length, reporter, markDelivered)
  return marked
}
