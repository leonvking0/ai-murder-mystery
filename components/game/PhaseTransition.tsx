'use client';

import { PHASE_LABELS, PHASE_NARRATIONS } from '@/lib/game-engine/phase-manager';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GamePhase } from '@/types/game';

interface PhaseTransitionProps {
  open: boolean;
  phase: GamePhase;
  onContinue: () => void;
}

export function PhaseTransition({ open, phase, onContinue }: PhaseTransitionProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="border-slate-700 bg-slate-950 text-slate-100 sm:max-w-xl"
      >
        <DialogHeader>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">GM 播报</p>
          <DialogTitle className="text-2xl text-amber-100">
            进入阶段：{PHASE_LABELS[phase]}
          </DialogTitle>
          <DialogDescription className="pt-2 text-base leading-relaxed text-slate-300">
            {PHASE_NARRATIONS[phase]}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button
            type="button"
            onClick={onContinue}
            className="bg-amber-700 text-amber-50 hover:bg-amber-600"
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
