import { motion } from 'framer-motion';
import { X } from 'lucide-react';

export function Overlay({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 flex items-start justify-center bg-ink-950/30 p-8 backdrop-blur-sm" onMouseDown={onClose}>
      <motion.div
        initial={{ y: 16, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 16, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-full w-full ${wide ? 'max-w-[860px]' : 'max-w-[680px]'} flex-col overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-2xl dark:border-ink-800 dark:bg-ink-900`}
      >
        <header className="flex items-center gap-3 border-b border-ink-200 px-5 py-3 dark:border-ink-800">
          <div className="flex-1 text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800" aria-label="Close">
            <X size={17} />
          </button>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      </motion.div>
    </motion.div>
  );
}
