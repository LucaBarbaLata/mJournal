/** Photo display with graceful fallbacks: thumbnail → original → a gentle "missing" placeholder. */
import { useEffect, useState } from 'react';
import type { PhotoRecord } from '@core/api';
import { requestThumbnail, useThumbnailVersion } from '../lib/thumbnails';
import { Icon } from './Icon';

interface PhotoImageProps {
  photo: PhotoRecord;
  alt: string;
  variant?: 'thumb' | 'full';
  className?: string;
}

export function PhotoImage({ photo, alt, variant = 'thumb', className }: PhotoImageProps) {
  // A thumbnail made this session shows right away, before the photo's data is reloaded.
  const version = useThumbnailVersion(photo.id);
  const initial = variant === 'thumb' && (photo.hasThumbnail || version > 0) ? 'thumb' : 'full';
  const [stage, setStage] = useState<'thumb' | 'full' | 'broken'>(initial);

  useEffect(() => setStage(initial), [photo.id, initial, version]);

  if (photo.missing || stage === 'broken') {
    return (
      <div className={`photo-missing ${className ?? ''}`} role="img" aria-label={`${alt} (the photo file is missing or damaged)`}>
        <Icon name="broken-image" size={22} />
        <span>Photo unavailable</span>
      </div>
    );
  }
  // A changed address makes sure a new thumbnail is loaded, not an earlier failed attempt.
  const thumbSrc = version > 0 ? `${photo.thumbUrl}?v=${version}` : photo.thumbUrl;
  return (
    <img
      className={className}
      src={stage === 'thumb' ? thumbSrc : photo.url}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
        if (stage === 'thumb') {
          // The stored thumbnail is gone: show the original meanwhile and make a new one.
          requestThumbnail(photo);
          setStage('full');
        } else {
          setStage('broken');
        }
      }}
    />
  );
}

export function photoAlt(photo: PhotoRecord, dateLabel: string): string {
  return photo.caption.trim() ? `${photo.caption.trim()} — photo from ${dateLabel}` : `Photo from ${dateLabel}`;
}
