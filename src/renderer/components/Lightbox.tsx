/** A larger view of a photo with its caption, the day it belongs to and gentle actions. */
import { useEffect, useRef, useState } from 'react';
import type { GalleryPhoto, PhotoRecord } from '@core/api';
import type { DateKey } from '@core/dates';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { invalidate } from '../lib/data';
import { href, navigate } from '../lib/router';
import { saveQueue } from '../lib/saveQueue';
import { useToday } from '../lib/time';
import { confirm } from './Dialog';
import { Icon } from './Icon';
import { MoodIcon } from './MoodIcon';
import { PhotoImage, photoAlt } from './Photo';
import { toast } from './Toasts';

interface LightboxProps {
  photos: (PhotoRecord | GalleryPhoto)[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Called after a caption, favorite or removal so the parent can refresh. */
  onChanged: () => void;
  /** Shown for photos from many days (Memories, Monthly): a link to the photo's day. */
  showOpenDay?: boolean;
  /** On a day's page: moves the photo one place earlier or later among the day's photos. */
  onShift?: (photoId: string, delta: -1 | 1) => void;
}

export function Lightbox({ photos, index, onIndexChange, onClose, onChanged, showOpenDay = false, onShift }: LightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { format, mood: moodFor } = useApp();
  const today = useToday();
  const photo = photos[index];
  const [caption, setCaption] = useState(photo?.caption ?? '');
  const [favorite, setFavorite] = useState(photo?.favorite ?? false);
  const [error, setError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<DateKey | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    setCaption(photo?.caption ?? '');
    setFavorite(photo?.favorite ?? false);
    setError(null);
    setMoveTo(null);
  }, [photo?.id]);

  if (!photo) return null;
  const gallery = 'excerpt' in photo ? photo : null;
  const mood = moodFor(gallery?.mood);
  const dateLabel = format.long(photo.date);

  const go = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < photos.length) onIndexChange(next);
  };

  const close = () => {
    void saveQueue.flush().then(onChanged);
    onClose();
  };

  const updateCaption = (value: string) => {
    setCaption(value);
    const id = photo.id;
    saveQueue.schedule(`caption:${id}`, async () => {
      await api.photos.update(id, { caption: value });
      invalidate('entries');
    });
  };

  const toggleFavorite = async () => {
    const next = !favorite;
    setFavorite(next);
    try {
      await api.photos.update(photo.id, { favorite: next });
      invalidate('entries', 'photos');
    } catch (err) {
      setFavorite(!next);
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove this photo from the day?',
      body: 'It moves to "Recently removed" in Settings, where you can restore it. The photo file is kept.',
      confirmLabel: 'Remove photo',
    });
    if (!ok) return;
    try {
      const id = photo.id;
      await api.photos.remove(id);
      invalidate('entries', 'photos');
      toast('Photo moved to Recently removed', {
        label: 'Undo',
        onClick: () => void api.photos.restore(id).then(() => {
          invalidate('entries', 'photos');
          onChanged();
        }),
      });
      onChanged();
      leaveList();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  /** The photo leaves this list (a day's photos): show a neighbour, or close when it was the last one. */
  const leaveList = () => {
    if (photos.length <= 1) onClose();
    else if (index >= photos.length - 1) onIndexChange(index - 1);
  };

  const moveToDay = async () => {
    if (!moveTo) return;
    try {
      await saveQueue.flush();
      const target = moveTo;
      await api.photos.moveToDay(photo.id, target);
      invalidate('entries', 'photos');
      setMoveTo(null);
      toast(`Photo moved to ${format.long(target)}`, { label: 'Open day', onClick: () => navigate(href.day(target)) });
      onChanged();
      if (!showOpenDay) leaveList();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (event.key === 'ArrowLeft') go(-1);
        if (event.key === 'ArrowRight') go(1);
      }}
    >
      <div className="lightbox-stage">
        <PhotoImage key={photo.id} photo={photo} alt={photoAlt(photo, dateLabel)} variant="full" className="lightbox-image" />
        {photos.length > 1 && (
          <>
            <button type="button" className="lightbox-nav prev" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous photo">
              <Icon name="chevron-left" size={22} />
            </button>
            <button
              type="button"
              className="lightbox-nav next"
              onClick={() => go(1)}
              disabled={index === photos.length - 1}
              aria-label="Next photo"
            >
              <Icon name="chevron-right" size={22} />
            </button>
          </>
        )}
      </div>
      <aside className="lightbox-panel">
        <div className="lightbox-top">
          <div>
            <p className="eyebrow">{photos.length > 1 ? `${index + 1} of ${photos.length}` : 'Photo'}</p>
            <h2 className="lightbox-date">{dateLabel}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close photo">
            <Icon name="close" />
          </button>
        </div>

        <label className="field">
          <span className="field-label">Caption</span>
          <textarea
            className="textarea"
            value={caption}
            maxLength={500}
            rows={3}
            placeholder="A few words about this moment…"
            onChange={(event) => updateCaption(event.target.value)}
          />
        </label>

        {gallery && (gallery.excerpt || mood) && (
          <div className="lightbox-reflection">
            <p className="eyebrow">From that day</p>
            {mood && (
              <p className="lightbox-mood">
                <MoodIcon icon={mood.icon} color={mood.color} size={22} /> {mood.label}
              </p>
            )}
            {gallery.excerpt && <p className="lightbox-excerpt">{gallery.excerpt}</p>}
          </div>
        )}

        {photo.missing && (
          <p className="notice">
            <Icon name="info" size={16} />
            <span>The file for this photo is missing from the data folder. Restoring a backup may bring it back.</span>
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            <Icon name="info" size={16} />
            <span>{error}</span>
          </p>
        )}

        {moveTo !== null && (
          <form
            className="lightbox-move"
            onSubmit={(event) => {
              event.preventDefault();
              void moveToDay();
            }}
          >
            <label className="field">
              <span className="field-label">Move this photo to</span>
              <input
                type="date"
                className="input"
                value={moveTo}
                max={today}
                required
                autoFocus
                onChange={(event) => setMoveTo(event.target.value)}
              />
            </label>
            <div className="row-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={!moveTo || moveTo === photo.date || moveTo > today}>
                Move
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMoveTo(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="lightbox-actions">
          <button type="button" className="btn" aria-pressed={favorite} onClick={toggleFavorite}>
            <Icon name="heart" size={16} filled={favorite} />
            {favorite ? 'Favorite' : 'Mark as favorite'}
          </button>
          {onShift && photos.length > 1 && (
            <>
              <button type="button" className="btn btn-ghost" disabled={index === 0} onClick={() => onShift(photo.id, -1)}>
                <Icon name="chevron-left" size={16} /> Move earlier
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={index === photos.length - 1}
                onClick={() => onShift(photo.id, 1)}
              >
                Move later <Icon name="chevron-right" size={16} />
              </button>
            </>
          )}
          {showOpenDay && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                close();
                navigate(href.day(photo.date));
              }}
            >
              <Icon name="journal" size={16} /> Open this day
            </button>
          )}
          {moveTo === null && (
            <button type="button" className="btn btn-ghost" onClick={() => setMoveTo(photo.date)}>
              <Icon name="move" size={16} /> Move to another day…
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void api.photos.showInFolder(photo.id)}>
            <Icon name="folder" size={16} /> Show file
          </button>
          <button type="button" className="btn btn-ghost" onClick={remove}>
            <Icon name="trash" size={16} /> Remove
          </button>
        </div>
      </aside>
    </dialog>
  );
}
