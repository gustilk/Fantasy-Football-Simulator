/** Keep app/proxy outages distinct from an upstream ESPN validation failure. */
export function standingsErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown request failure.';
  if (/<(?:!doctype\s+html|html|head|body)\b/i.test(message)) {
    return 'The app’s standings service is unavailable. Reload the app or try again shortly. Saved standings are unchanged.';
  }
  if (error instanceof TypeError && /fetch|network|load failed/i.test(message)) {
    return 'The app’s standings service could not be reached. Check your connection and try again. Saved standings are unchanged.';
  }
  return `ESPN standings could not be loaded: ${message} Saved standings are unchanged.`;
}
