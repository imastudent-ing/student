import { create } from 'zustand';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface UiStore {
  toasts: Toast[];
  showToast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUiStore = create<UiStore>((set) => ({
  toasts: [],
  showToast: (message, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}));
