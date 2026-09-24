'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui';

/** Error boundary for every workspace page; the sidebar stays usable. */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const chunkFailed = /ChunkLoadError|Loading chunk|dynamically imported module/i.test(`${error.name} ${error.message}`);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600"><AlertTriangle className="size-6" /></div>
        <h1 className="text-lg font-semibold text-ink-900">{chunkFailed ? 'Segue has been updated' : 'Something went wrong on this page'}</h1>
        <p className="mt-2 text-sm text-ink-500">{chunkFailed ? 'Reload to get the latest version. Nothing you saved has been lost.' : 'You can try again, or go back to your workspaces.'}</p>
        {!chunkFailed && <pre className="mt-4 overflow-x-auto rounded-lg bg-ink-100 p-3 text-left text-xs text-ink-600">{error.message}{error.digest ? ` (ref ${error.digest})` : ''}</pre>}
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/"><Button>Workspaces</Button></Link>
          <Button variant="primary" icon={<RefreshCw className="size-4" />} onClick={() => (chunkFailed ? window.location.reload() : reset())}>{chunkFailed ? 'Reload' : 'Try again'}</Button>
        </div>
      </div>
    </div>
  );
}
