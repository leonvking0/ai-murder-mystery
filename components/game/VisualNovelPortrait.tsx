'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';

import { cn } from '@/lib/utils';

const FADE_DURATION_MS = 360;

export interface VisualNovelSpeaker {
  id: string;
  name: string;
  avatar?: string;
}

interface VisualNovelPortraitProps {
  speaker: VisualNovelSpeaker | null;
  modeLabel: string;
  subtitle?: string;
  className?: string;
}

interface PortraitLayerProps {
  speaker: VisualNovelSpeaker;
  src: string;
  className?: string;
  onError: (src: string) => void;
}

function resolvePortraitSrc(speaker: VisualNovelSpeaker, failedSources: Record<string, boolean>): string | null {
  const preferred = speaker.avatar && speaker.avatar.trim().length > 0
    ? speaker.avatar
    : `/images/characters/${speaker.id}.png`;

  if (!failedSources[preferred]) {
    return preferred;
  }

  const fallback = `/images/characters/${speaker.id}.png`;
  if (!failedSources[fallback]) {
    return fallback;
  }

  return null;
}

function PortraitLayer({ speaker, src, className, onError }: PortraitLayerProps) {
  return (
    <Image
      src={src}
      alt={`${speaker.name}立绘`}
      fill
      sizes="(min-width: 1024px) 780px, 100vw"
      className={cn(
        'object-contain object-bottom opacity-85 [filter:saturate(0.88)_contrast(1.05)]',
        className,
      )}
      onError={() => onError(src)}
      priority={false}
    />
  );
}

export function VisualNovelPortrait({ speaker, modeLabel, subtitle, className }: VisualNovelPortraitProps) {
  const currentSpeakerRef = useRef<VisualNovelSpeaker | null>(speaker);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<VisualNovelSpeaker | null>(speaker);
  const [previousSpeaker, setPreviousSpeaker] = useState<VisualNovelSpeaker | null>(null);
  const [fadeReady, setFadeReady] = useState(false);
  const [failedSources, setFailedSources] = useState<Record<string, boolean>>({});

  useEffect(() => {
    return () => {
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const previous = currentSpeakerRef.current;
    const next = speaker;

    const isSameSpeaker = previous?.id === next?.id
      && previous?.name === next?.name
      && previous?.avatar === next?.avatar;

    if (isSameSpeaker) {
      return;
    }

    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current);
    }

    setPreviousSpeaker(previous);
    setCurrentSpeaker(next);
    currentSpeakerRef.current = next;
    setFadeReady(false);

    const frame = requestAnimationFrame(() => {
      setFadeReady(true);
    });

    fadeTimeoutRef.current = setTimeout(() => {
      setPreviousSpeaker(null);
      setFadeReady(false);
      fadeTimeoutRef.current = null;
    }, FADE_DURATION_MS + 80);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [speaker]);

  const currentSrc = useMemo(() => {
    if (!currentSpeaker) {
      return null;
    }

    return resolvePortraitSrc(currentSpeaker, failedSources);
  }, [currentSpeaker, failedSources]);

  const previousSrc = useMemo(() => {
    if (!previousSpeaker) {
      return null;
    }

    return resolvePortraitSrc(previousSpeaker, failedSources);
  }, [failedSources, previousSpeaker]);

  const handleImageError = (src: string) => {
    setFailedSources(prev => ({
      ...prev,
      [src]: true,
    }));
  };

  return (
    <section className={cn('border-b border-slate-700/60', className)}>
      <div className="relative isolate h-[230px] overflow-hidden bg-slate-950 sm:h-[260px]">
        {previousSpeaker && previousSrc && (
          <PortraitLayer
            speaker={previousSpeaker}
            src={previousSrc}
            className={cn(
              'absolute inset-0 transition-opacity',
              fadeReady ? 'opacity-0 duration-300' : 'opacity-100 duration-0',
            )}
            onError={handleImageError}
          />
        )}

        {currentSpeaker && currentSrc ? (
          <PortraitLayer
            speaker={currentSpeaker}
            src={currentSrc}
            className={cn(
              'absolute inset-0 transition-opacity',
              previousSpeaker ? (fadeReady ? 'opacity-100 duration-300' : 'opacity-0 duration-0') : 'opacity-100',
            )}
            onError={handleImageError}
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(148,163,184,0.2),transparent_40%),linear-gradient(150deg,#020617,#0f172a_55%,#111827)]" />
        )}

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0)_36%,rgba(2,6,23,0.72)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/45 to-slate-950/10" />

        <div className="absolute inset-x-0 top-0 px-5 pt-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-300/95">{modeLabel}</p>
        </div>

        <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
          <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-500/40 bg-slate-900/55 px-3 py-2 backdrop-blur-sm">
            <p className="truncate text-base font-semibold text-amber-100">
              {currentSpeaker?.name ?? '等待角色发言'}
            </p>
            {subtitle && (
              <p className="mt-0.5 line-clamp-2 text-xs text-slate-200/90">{subtitle}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
