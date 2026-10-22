import { useState, type FormEvent } from 'react';
import { Briefcase } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, ErrorNote, Field, Input } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-full place-items-center bg-forest-deep bg-[radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1px)] p-16 [background-size:18px_18px]">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-2xl bg-surface p-28 shadow-[0_40px_100px_-30px_rgb(0_0_0/0.7)] ring-1 ring-black/20">
        <div className="flex items-center gap-8">
          <span className="grid size-32 place-items-center rounded-md bg-forest text-mint">
            <Briefcase className="size-16" strokeWidth={1.8} />
          </span>
          <span className="text-14 font-semibold">Recruitment CRM</span>
        </div>
        <h1 className="heading mt-24 text-24">Sign in</h1>
        <p className="mt-6 text-10 text-ink-3">Employee accounts only. Ask your admin if you need access.</p>
        <div className="mt-20 space-y-12">
          <Field label="Work email">
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Sign in
          </Button>
        </div>
      </form>
    </div>
  );
}
