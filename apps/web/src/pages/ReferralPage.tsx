// Public page behind an employee's referral link (no login).
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, CheckCircle2, FileUp } from 'lucide-react';
import { api } from '../lib/api';
import { Button, ErrorNote, Field, Input, Loading, Textarea } from '../components/ui';

export function ReferralPage() {
  const code = useParams().code!;
  const { data, isLoading, error } = useQuery({ queryKey: ['referral', code], queryFn: () => api.get<{ referrerName: string }>(`/public/referral/${code}`), retry: false });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [file, setFile] = useState<File | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    fd.delete('resume');
    if (file) fd.append('resume', file);
    try {
      const res = await fetch(`/api/public/referral/${code}`, { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not submit');
      setDone(true);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-full bg-paper p-16">
      <div className="mx-auto max-w-[560px] py-24">
        <div className="mb-16 flex items-center gap-8">
          <span className="grid size-28 place-items-center rounded-md bg-forest text-mint"><Briefcase className="size-14" strokeWidth={1.8} /></span>
          <span className="text-14 font-semibold">Careers</span>
        </div>
        {isLoading ? (
          <Loading />
        ) : error || !data ? (
          <p className="card p-24 text-11">This referral link is not valid any more.</p>
        ) : done ? (
          <div className="card flex flex-col items-center gap-8 p-32 text-center">
            <CheckCircle2 className="size-32 text-moss" strokeWidth={1.5} />
            <p className="title text-16">Thank you!</p>
            <p className="text-11 text-ink-2">Your details reached {data.referrerName}'s recruitment team. They'll be in touch if a role fits.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-12 p-24">
            <div>
              <h1 className="heading text-24">Share your profile</h1>
              <p className="mt-6 text-11 text-ink-2">Referred by {data.referrerName}. We'll match you with current openings.</p>
            </div>
            <div className="grid grid-cols-2 gap-10">
              <Field label="Full name *" className="col-span-2"><Input name="name" required minLength={2} /></Field>
              <Field label="Mobile *"><Input name="phone" required inputMode="tel" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="Current company"><Input name="currentCompany" /></Field>
              <Field label="Designation"><Input name="currentTitle" /></Field>
              <Field label="Total experience (years)"><Input name="totalExp" inputMode="decimal" /></Field>
              <Field label="Current location"><Input name="location" /></Field>
              <Field label="Key skills" className="col-span-2"><Input name="skills" placeholder="e.g. Java, Spring Boot, AWS" /></Field>
              <Field label="Resume (PDF or Word)" className="col-span-2">
                <label className="flex cursor-pointer items-center gap-8 rounded-md px-12 py-10 text-10 text-ink-2 ring-1 ring-ink/20 hover:bg-paper">
                  <FileUp className="size-16" /> {file ? file.name : 'Choose a file'}
                  <input name="resume" type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </Field>
              <Field label="Anything else?" className="col-span-2"><Textarea name="message" /></Field>
              <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
            </div>
            <ErrorNote error={err} />
            <Button type="submit" variant="primary" loading={busy} className="w-full">Submit</Button>
            <p className="text-9 text-ink-3">Your details are used only for recruitment and shared with clients only with your consent.</p>
          </form>
        )}
      </div>
    </div>
  );
}
