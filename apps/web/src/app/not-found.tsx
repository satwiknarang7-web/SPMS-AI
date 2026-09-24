import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-5xl font-extrabold tracking-tight text-ink-300">404</div>
      <h1 className="text-lg font-semibold text-ink-900">Page not found</h1>
      <p className="text-sm text-ink-500">That address doesn&apos;t exist in Segue.</p>
      <Link href="/" className="mt-2 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800">Back to workspaces</Link>
    </div>
  );
}
