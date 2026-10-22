import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'error';
}
const ToastContext = createContext<(message: string, tone?: 'ok' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      tone === 'error' ? 7000 : 3500,
    );
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed bottom-16 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-8"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex max-w-[520px] items-center gap-8 rounded-full px-16 py-9 text-11 shadow-pop animate-pop',
              t.tone === 'ok' ? 'bg-forest text-mint' : 'bg-surface text-signal-red',
            )}
          >
            {t.tone === 'ok' ? (
              <CheckCircle2 className="size-14 shrink-0" strokeWidth={1.8} />
            ) : (
              <AlertCircle className="size-14 shrink-0" strokeWidth={1.8} />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
