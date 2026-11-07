/** Tags: the quick chips on every day's page, and the other tags that days have. */
import { useState } from 'react';
import type { TagRecord } from '@core/api';
import { MAX_TAG_LENGTH } from '@core/tags';
import { confirm } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { api, errorMessage } from '../../lib/api';
import { invalidate, useQuery } from '../../lib/data';
import { href } from '../../lib/router';
import { SettingsSection } from '../SettingsView';

const daysLabel = (n: number) => (n === 0 ? 'not used yet' : n === 1 ? '1 day' : `${n} days`);

export function TagSettings() {
  const tags = useQuery('tags', () => api.tags.list(), ['tags', 'entries']);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ name: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = tags.data ?? [];
  const quick = list.filter((t) => t.quick);
  const others = list.filter((t) => !t.quick);

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      invalidate('tags', 'entries');
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  const move = (index: number, delta: number) => {
    const names = quick.map((t) => t.name);
    const target = index + delta;
    if (target < 0 || target >= names.length) return;
    [names[index], names[target]] = [names[target], names[index]];
    void run(() => api.tags.reorder([...names, ...others.map((t) => t.name)]));
  };

  const remove = async (tag: TagRecord) => {
    const ok = await confirm({
      title: `Remove “${tag.label}”?`,
      body: tag.written
        ? `It’s taken off the days you tapped it on. Days where you wrote #${tag.label} keep it, because it’s part of your writing.`
        : tag.days > 0
          ? `It’s taken off the ${daysLabel(tag.days)} that have it. Nothing else about those days changes.`
          : 'It won’t be offered as a chip any more.',
      confirmLabel: 'Remove tag',
    });
    if (ok) void run(() => api.tags.remove(tag.name));
  };

  const row = (tag: TagRecord, index: number) => (
    <li key={tag.name}>
      {editing?.name === tag.name ? (
        <form
          className="inline-form grow"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.tags.update(tag.name, { label: editing.label })).then((ok) => ok && setEditing(null));
          }}
        >
          <input
            className="input"
            value={editing.label}
            maxLength={MAX_TAG_LENGTH}
            autoFocus
            aria-label={`Rename “${tag.label}”`}
            onChange={(event) => setEditing({ name: tag.name, label: event.target.value })}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!editing.label.trim()}>
            Save
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="tag-settings-label">
            <span className="tag-chip static">{tag.written && !tag.quick ? `#${tag.label}` : tag.label}</span>
            <span className="muted">
              {tag.days > 0 ? <a href={href.journal({ tags: tag.name })}>{daysLabel(tag.days)}</a> : daysLabel(tag.days)}
              {tag.written ? ' · in your writing' : ''}
            </span>
          </span>
          {tag.quick ? (
            <>
              <button type="button" className="icon-btn" aria-label={`Move ${tag.label} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <Icon name="arrow-up" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${tag.label} down`}
                disabled={index === quick.length - 1}
                onClick={() => move(index, 1)}
              >
                <Icon name="arrow-down" size={16} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(() => api.tags.update(tag.name, { quick: false }))}>
                No chip
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(() => api.tags.update(tag.name, { quick: true }))}>
              <Icon name="plus" size={14} /> Make a chip
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Rename “${tag.label}”`}
            title={tag.written ? `Written as #${tag.label}: change it in your writing` : 'Rename'}
            disabled={tag.written}
            onClick={() => setEditing({ name: tag.name, label: tag.label })}
          >
            <Icon name="pencil" size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label={`Remove “${tag.label}”`} onClick={() => void remove(tag)}>
            <Icon name="trash" size={16} />
          </button>
        </>
      )}
    </li>
  );

  return (
    <SettingsSection
      id="tags"
      title="Tags"
      description="Tap a tag on any day’s page, or write #something anywhere in a day — a walk, a person, a place. Journal can find days by tag, and Insights counts them."
    >
      <h3 className="sub-heading">Quick chips</h3>
      <p className="muted">These are on every day’s page, ready to tap.</p>
      {quick.length === 0 ? <p className="muted">No quick chips.</p> : <ul className="tag-settings">{quick.map(row)}</ul>}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) void run(() => api.tags.create(draft.trim())).then((ok) => ok && setDraft(''));
        }}
      >
        <label className="visually-hidden" htmlFor="new-tag">
          New quick chip
        </label>
        <input
          id="new-tag"
          className="input"
          value={draft}
          maxLength={MAX_TAG_LENGTH}
          placeholder="A new chip, like “Yoga” or “Grandma”…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn" disabled={!draft.trim()}>
          <Icon name="plus" size={16} /> Add
        </button>
      </form>

      {others.length > 0 && (
        <>
          <h3 className="sub-heading">Other tags</h3>
          <p className="muted">Tags from your #writing, and chips you put away.</p>
          <ul className="tag-settings">{others.map(row)}</ul>
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{error}</span>
        </p>
      )}
    </SettingsSection>
  );
}
