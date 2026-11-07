/** The Linux autostart file for "Open mJournal when I sign in" (pure text; written by autostart.ts). */

export const HIDDEN_ARG = '--hidden';

/**
 * One argument of a desktop file's Exec key, quoted as the Desktop Entry Specification asks: inside double
 * quotes, `"`, `` ` ``, `$` and `\` get a backslash; then, because the value is also a string, every backslash
 * is doubled; and `%` is written `%%` (it would start a field code).
 */
export function desktopExecArg(arg: string): string {
  const quoted = `"${arg.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;
  return quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}

export function desktopEntry(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=mJournal',
    'Comment=Opens mJournal in the background, ready for the evening reminder',
    `Exec=${desktopExecArg(executable)} ${HIDDEN_ARG}`,
    'Icon=mjournal',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}
