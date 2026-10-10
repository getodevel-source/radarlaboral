export const WINDOWS_APP_USER_MODEL_ID = 'ar.radarlaboral.desktop'
export const WINDOWS_TOAST_ACTIVATOR_CLSID = '{017378BE-4BF1-42DA-A318-80EDED2C1A4B}'

export type WindowsNotificationIdentityApi = {
  setAppUserModelId: (id: string) => void
  setToastActivatorCLSID: (id: string) => void
}

export function configureWindowsNotificationIdentity(
  platform: string,
  application: WindowsNotificationIdentityApi,
) {
  if (platform !== 'win32') return false

  application.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
  application.setToastActivatorCLSID(WINDOWS_TOAST_ACTIVATOR_CLSID)
  return true
}
