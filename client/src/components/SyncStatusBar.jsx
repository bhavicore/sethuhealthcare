import { useEffect, useState } from 'react';
import { subscribeSyncStatus, trySync } from '../lib/sync';

export default function SyncStatusBar() {
  const [status, setStatus] = useState({ online: navigator.onLine, pendingCount: 0 });

  useEffect(() => subscribeSyncStatus(setStatus), []);

  return (
    <div className={`sync-bar ${status.online ? 'sync-bar--online' : 'sync-bar--offline'}`}>
      <span className="sync-bar__dot" aria-hidden="true" />
      <span className="sync-bar__label">
        {status.online ? 'Online' : 'Offline (saving on this device)'}
      </span>
      {status.pendingCount > 0 && (
        <span className="sync-bar__pending">{status.pendingCount} queued</span>
      )}
      {status.syncing && <span className="sync-bar__syncing">Syncing…</span>}
      {status.lastError && (
        <button className="sync-bar__retry" onClick={() => trySync()}>
          Retry sync
        </button>
      )}
    </div>
  );
}
