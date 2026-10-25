/** Photo display with graceful fallbacks: thumbnail → original → a gentle "missing" placeholder. */
import { useEffect, useState } from 'react';
import type { PhotoRecord } from '@core/api';
import { Icon } from './Icon';

interface PhotoImageProps {
  photo: PhotoRecord;
  alt: string;
  variant?: 'thumb' | 'full';
  className?: string;
}

export function PhotoImage({ photo, alt, variant = 'thumb', className }: PhotoImageProps) {
  const initial = variant === 'thumb' && photo.hasThumbnail ? 'thumb' : 'full';
  const [stage, setStage] = useState<'thumb' | 'full' | 'broken'>(initial);

  useEffect(() => setStage(initial), [photo.id, initial]);

  if (photo.missing || stage === 'broken') {
    return (
      <div className={`photo-missing ${className ?? ''}`} role="img" aria-label={`${alt} (the photo file is missing or damaged)`}>
        <Icon name="broken-image" size={22} />
        <span>Photo unavailable</span>
      </div>
    );
  }
  return (
    <img
      className={className}
      src={stage === 'thumb' ? photo.thumbUrl : photo.url}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setStage((s) => (s === 'thumb' ? 'full' : 'broken'))}
    />
  );
}

export function photoAlt(photo: PhotoRecord, dateLabel: string): string {
  return photo.caption.trim() ? `${photo.caption.trim()} — photo from ${dateLabel}` : `Photo from ${dateLabel}`;
}
