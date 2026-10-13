/**
 * The two sides, as plain data both the server and every screen read: their names, colours (the
 * names over their heads, the HUD) and the colour of their blaster bolts.
 */

export type Team = 0 | 1;
export const TEAM_IDS: readonly Team[] = [0, 1];

export interface TeamInfo {
  id: 'rebels' | 'empire';
  name: string;
  /** Short, in capitals, for the HUD. */
  short: string;
  /** Names over heads, the HUD's side colours. */
  color: string;
  /** Their blasters' bolts. */
  bolt: string;
}

export const TEAMS: [TeamInfo, TeamInfo] = [
  { id: 'rebels', name: 'Rebel Alliance', short: 'REBELS', color: '#ff9f43', bolt: '#ff5a1f' },
  { id: 'empire', name: 'Galactic Empire', short: 'EMPIRE', color: '#7cc4ff', bolt: '#ff1f3d' },
];

export const other = (t: Team): Team => (t === 0 ? 1 : 0);
