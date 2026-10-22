import { FileText } from 'lucide-react';
import { api } from '../lib/api';
import type { Resume } from '../lib/types';
import { useToast } from '../components/toast';

/** Opens a resume through a short-lived signed URL. */
export function ResumeLink({
  resume,
  label,
}: {
  resume: Pick<Resume, 'id' | 'fileName' | 'versionNo'>;
  label?: string;
}) {
  const toast = useToast();
  const open = async () => {
    const win = window.open('', '_blank');
    try {
      const { url } = await api.get<{ url: string }>(`/resumes/${resume.id}/url`);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (e) {
      win?.close();
      toast((e as Error).message, 'error');
    }
  };
  return (
    <button
      onClick={() => void open()}
      className="inline-flex max-w-full items-center gap-4 text-forest-2 hover:underline"
    >
      <FileText className="size-12 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{label ?? `v${resume.versionNo} · ${resume.fileName}`}</span>
    </button>
  );
}
