/** Layout of the mJournal data folder. Pure path logic, no Electron. */
import { join } from 'node:path';

export interface DataPaths {
  root: string;
  database: string;
  photos: string;
  thumbnails: string;
  backups: string;
  snapshots: string;
  temp: string;
  logs: string;
}

export const DATABASE_FILE = 'mjournal.db';

export function dataPaths(root: string): DataPaths {
  return {
    root,
    database: join(root, DATABASE_FILE),
    photos: join(root, 'photos'),
    thumbnails: join(root, 'thumbnails'),
    backups: join(root, 'backups'),
    snapshots: join(root, 'backups', 'automatic'),
    temp: join(root, '.tmp'),
    logs: join(root, 'logs'),
  };
}
