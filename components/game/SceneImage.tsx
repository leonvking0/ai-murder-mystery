'use client';

import { useState } from 'react';
import Image from 'next/image';

import { cn } from '@/lib/utils';

interface SceneImageProps {
  src?: string;
  alt: string;
  title: string;
  subtitle: string;
  badge?: string;
  className?: string;
}

export function SceneImage({ src, alt, title, subtitle, badge, className }: SceneImageProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const imageSrc = src && src !== failedSrc ? src : undefined;
  const isLoaded = imageSrc ? loadedSrc === imageSrc : false;

  return (
    <section
      className={cn(
        'relative isolate overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-950/70',
        className,
      )}
    >
      <div className="relative h-44 w-full md:h-52">
        {imageSrc ? (
          <Image
            key={imageSrc}
            src={imageSrc}
            alt={alt}
            fill
            sizes="(min-width: 1024px) 1200px, 100vw"
            className={[
              'object-cover transition-opacity duration-700',
              isLoaded ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            onLoad={() => setLoadedSrc(imageSrc)}
            onError={() => setFailedSrc(imageSrc)}
            priority
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(245,158,11,0.2),transparent_45%),linear-gradient(140deg,#0f172a,#111827_52%,#020617)]" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/55 to-slate-900/10" />
        <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
          {badge && (
            <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200/90">{badge}</p>
          )}
          <h2 className="mt-1 text-lg font-semibold text-slate-100 md:text-xl">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-200/90">{subtitle}</p>
        </div>
      </div>
    </section>
  );
}
