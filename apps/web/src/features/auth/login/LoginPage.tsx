'use client';

import { MODULE_KEYS } from '@segue/shared';
import { ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '@/features/auth/session';
import { MODULE_UI } from '@/lib/modules';
import { accentStyle } from '@/components/layout/AppShell';
import { ProductMark } from '@/components/layout/Brand';
import { Alert, Button, Field, Input, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';

const DEMO = [
  ['owner@harbourside.demo', 'Group owner — all modules'],
  ['pharmacist@harbourside.demo', 'Pharmacist'],
  ['tech@harbourside.demo', 'Dispensary technician'],
  ['cashier@harbourside.demo', 'Pharmacy assistant (POS)'],
  ['manager@harbourside.demo', 'Store manager (Office)'],
  ['pricing@harbourside.demo', 'HQ pricing manager'],
  ['owner@cornerchemist.demo', 'Single store — Dispense + POS only'],
  ['vendor@segue.demo', 'Segue licensing console'],
] as const;

export function LoginPage() {
  const { session, login } = useSession();
  const router = useRouter();
  // Only same-app paths are honoured, so ?from= can't be used as an open redirect.
  const fromParam = useSearchParams().get('from');
  const from = fromParam && fromParam.startsWith('/') && !fromParam.startsWith('//') ? fromParam : '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) router.replace(session.user.isPlatformAdmin && !session.tenant ? '/vendor' : from);
  }, [session, router, from]);
  if (session) return <Loading className="h-full" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await login(email, password);
      router.replace(s.user.isPlatformAdmin ? '/vendor' : from);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]" style={accentStyle('#7c4dbd')}>
      <div className="relative hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-40 -right-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(124,77,189,0.35),transparent_65%)]" />
        <div className="absolute -bottom-48 -left-24 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(10,120,194,0.3),transparent_65%)]" />
        <div className="relative">
          <ProductMark inverted size="lg" />
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-4xl leading-tight font-bold tracking-tight">One connected platform for the modern Australian pharmacy.</h1>
          <p className="mt-4 text-ink-300">Dispensing, retail, store operations and head office — sharing one product, inventory and pricing model, licensed module by module.</p>
          <div className="mt-10 grid grid-cols-2 gap-3">
            {MODULE_KEYS.map((k) => (
              <div key={k} className="rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
                <ProductMark module={MODULE_UI[k].label} color={MODULE_UI[k].color} size="sm" inverted />
              </div>
            ))}
          </div>
          <div className="mt-10 flex items-center gap-2 text-xs text-ink-400">
            <ShieldCheck className="size-4" /> Data hosted in Australia · Privacy Act 1988 (APPs) · Tamper-evident audit trail
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <ProductMark size="md" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">Sign in</h2>
          <p className="mt-1 text-sm text-ink-500">Use your Segue account. Your organisation's licence decides which workspaces you can open.</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            {error && <Alert tone="red">{error}</Alert>}
            <Field label="Email">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required icon={<Lock />} />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              Sign in <ArrowRight className="size-4" />
            </Button>
          </form>

          <div className="mt-10 rounded-2xl bg-white p-4 ring-1 ring-ink-200">
            <div className="text-xs font-semibold tracking-wider text-ink-500 uppercase">Demo accounts</div>
            <p className="mt-1 text-xs text-ink-500">
              Password for all: <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-ink-700">Segue2026!</code>
            </p>
            <div className="mt-3 space-y-1">
              {DEMO.map(([e, label]) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setEmail(e);
                    setPassword('Segue2026!');
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-ink-50"
                >
                  <span className="font-medium text-ink-800">{label}</span>
                  <span className="truncate pl-2 text-ink-400">{e}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
