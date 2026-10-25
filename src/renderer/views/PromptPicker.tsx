/** Browse the prompt library, mark favorites, or add your own question. */
import { useMemo, useState } from 'react';
import type { PromptInfo } from '@core/api';
import { PROMPT_CATEGORIES, categoryLabel } from '@core/prompts';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { invalidate, useQuery } from '../lib/data';

type Filter = 'all' | 'favorites' | 'custom' | (typeof PROMPT_CATEGORIES)[number]['key'];

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (prompt: PromptInfo) => void;
  exclude: ReadonlySet<string>;
}

export function PromptPicker({ open, onClose, onPick, exclude }: Props) {
  const library = useQuery('prompt-library', () => api.prompts.library(), ['prompts']);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (library.data ?? []).filter((p) => {
      if (p.hidden || exclude.has(p.id)) return false;
      if (filter === 'favorites' && !p.favorite) return false;
      if (filter === 'custom' && !p.custom) return false;
      if (filter !== 'all' && filter !== 'favorites' && filter !== 'custom' && p.category !== filter) return false;
      return !needle || p.text.toLowerCase().includes(needle);
    });
  }, [library.data, filter, search, exclude]);

  const toggleFavorite = async (prompt: PromptInfo) => {
    try {
      await api.prompts.setFavorite(prompt.id, !prompt.favorite);
      invalidate('prompts');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const addCustom = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      const created = await api.prompts.createCustom(text);
      invalidate('prompts');
      setDraft('');
      onPick(created);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'favorites', label: 'Favorites' },
    { key: 'custom', label: 'My prompts' },
    ...PROMPT_CATEGORIES.map((c) => ({ key: c.key as Filter, label: c.label })),
  ];

  return (
    <Dialog open={open} onClose={onClose} title="Add a prompt" wide>
      <p className="muted">Every prompt is optional. Pick one that feels right, or write your own.</p>
      <div className="prompt-search">
        <Icon name="search" size={18} />
        <input
          className="input"
          type="search"
          placeholder="Search questions"
          aria-label="Search questions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="chip-row" role="group" aria-label="Filter prompts">
        {filters.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.key === 'favorites' && <Icon name="heart" size={13} filled />}
            {f.label}
          </button>
        ))}
      </div>
      <ul className="prompt-list" aria-label="Prompts">
        {items.map((prompt) => (
          <li key={prompt.id}>
            <button type="button" className="prompt-option" onClick={() => onPick(prompt)}>
              <span className="prompt-option-text">{prompt.text}</span>
              <span className="prompt-option-category">{categoryLabel(prompt.category)}</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-pressed={prompt.favorite}
              aria-label={prompt.favorite ? `Remove "${prompt.text}" from favorites` : `Add "${prompt.text}" to favorites`}
              onClick={() => void toggleFavorite(prompt)}
            >
              <Icon name="heart" size={17} filled={prompt.favorite} />
            </button>
          </li>
        ))}
        {library.data && items.length === 0 && (
          <li className="prompt-list-empty muted">
            {filter === 'favorites'
              ? 'No favorites yet — tap the heart next to a question you love.'
              : filter === 'custom'
                ? 'You haven’t written any prompts yet. Add one below.'
                : 'No prompts match your search.'}
          </li>
        )}
      </ul>
      <form
        className="custom-prompt-form"
        onSubmit={(event) => {
          event.preventDefault();
          void addCustom();
        }}
      >
        <label className="field">
          <span className="field-label">Write your own question</span>
          <div className="inline-form">
            <input
              className="input"
              value={draft}
              maxLength={300}
              placeholder="What would I like to ask myself?"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
              <Icon name="plus" size={16} /> Add
            </button>
          </div>
        </label>
        {error && (
          <p className="notice error" role="alert">
            <Icon name="info" size={16} />
            <span>{error}</span>
          </p>
        )}
      </form>
    </Dialog>
  );
}
