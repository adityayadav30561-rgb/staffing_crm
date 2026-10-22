import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { Button, Card, Field, Input, PageHeader } from '../components/ui';
import { useToast } from '../components/toast';

export function ProfilePage() {
  const me = useMe();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const link = `${window.location.origin}/refer/${me.referralCode}`;
  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { currentPassword: cur, newPassword: next }),
    onSuccess: () => {
      setCur('');
      setNext('');
      toast('Password changed. Other devices were signed out.');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <>
      <PageHeader title={me.name} subtitle={`${me.email} · ${me.role}`} />
      <div className="grid max-w-[960px] gap-12 lg:grid-cols-2">
        <Card title="Your referral link">
          <p className="mb-10 text-10 text-ink-2">
            Share this link in your network or WhatsApp groups. People who apply through it are added as candidates with source “Referral – {me.name}” and you get notified.
          </p>
          <div className="flex gap-8">
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
            <Button icon={<Copy className="size-14" />} onClick={() => void navigator.clipboard.writeText(link).then(() => toast('Link copied'))}>Copy</Button>
          </div>
        </Card>
        <Card title="Change password">
          <div className="space-y-10">
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field label="New password" hint="At least 10 characters"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <div className="flex justify-end"><Button variant="primary" loading={change.isPending} disabled={!cur || next.length < 10} onClick={() => change.mutate()}>Change password</Button></div>
          </div>
        </Card>
      </div>
    </>
  );
}
