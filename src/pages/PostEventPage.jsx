import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CATEGORIES, NEIGHBORHOOD_NAMES } from '../data/neighborhoods';
import { useAuth } from '../contexts/useAuth';
import { useAuthModal } from '../contexts/useAuthModal';
import { createEvent, getEventRow, makeTimestamp, updateEvent } from '../services/events';
import { uploadImage } from '../services/uploads';
import {
  buildEventPayload,
  dateInputValue,
  MAX_TAGS,
  timeInputValue,
  validateEventForm,
} from '../utils/events';

const emptyForm = {
  title: '',
  description: '',
  category: 'Community',
  tags: '',
  neighborhood: '',
  address: '',
  date: '',
  time: '',
  endTime: '',
  price: 'Free',
  capacity: '',
  imageUrl: '',
  rsvpUrl: '',
};

function formFromEventRow(row) {
  return {
    title: row.title || '',
    description: row.description || '',
    category: row.category || 'Community',
    tags: Array.isArray(row.tags) ? row.tags.join(', ') : '',
    neighborhood: row.neighborhood || '',
    address: row.address || '',
    date: dateInputValue(row.startAt),
    time: timeInputValue(row.startAt),
    endTime: row.endAt ? timeInputValue(row.endAt) : '',
    price: row.price || 'Free',
    capacity: row.capacity ?? '',
    imageUrl: row.imageUrl || '',
    rsvpUrl: row.rsvpUrl || '',
  };
}

function Field({ id, label, error, hint, children }) {
  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field__hint">{hint}</span>
      )}
    </div>
  );
}

function PostEventPage() {
  const { user, loading } = useAuth();
  const { openLogin, openSignup } = useAuthModal();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const isEdit = Boolean(editId);

  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(isEdit);
  const [loadError, setLoadError] = useState('');

  // Edit mode: pull the existing doc once and verify ownership.
  useEffect(() => {
    if (!editId || !user) return undefined;
    let cancelled = false;

    getEventRow(editId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setLoadError('That event no longer exists.');
        } else if (row.hostUid !== user.uid) {
          setLoadError('You can only edit events you posted.');
        } else {
          setForm(formFromEventRow(row));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err?.message?.replace('Firebase:', '').trim() || 'Could not load this event.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEvent(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editId, user]);

  const update = (field) => (e) => {
    const { value } = e.target;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleImageFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;

    setUploading(true);
    setSubmitError('');
    try {
      const safeName = file.name.replace(/[^a-z0-9._-]/gi, '-').slice(-40);
      const url = await uploadImage(file, `events/${user.uid}/${Date.now()}-${safeName}`);
      setForm((prev) => ({ ...prev, imageUrl: url }));
      setErrors((prev) => ({ ...prev, imageUrl: undefined }));
    } catch (err) {
      setSubmitError(err.message || 'Upload failed. Try pasting an image URL instead.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    // Editing an older event shouldn't be blocked by the "future date" rule.
    const nextErrors = validateEventForm(form, isEdit ? new Date(0) : new Date());
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      const firstField = Object.keys(nextErrors)[0];
      document.getElementById(`event-${firstField}`)?.focus();
      return;
    }
    if (!user) return;

    setSubmitting(true);
    try {
      const payload = buildEventPayload(form, { makeTimestamp, isEdit });
      if (isEdit) {
        await updateEvent(editId, payload);
        navigate(`/event/${editId}`);
      } else {
        const newId = await createEvent(payload, user);
        navigate(`/event/${newId}`);
      }
    } catch (err) {
      setSubmitError(
        err?.message?.replace('Firebase:', '').trim() ||
          'Could not publish your event. Please try again.',
      );
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="form-page">
        <div className="shell">
          <p className="map-note">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="form-page">
        <div className="shell">
          <div className="empty-state" style={{ maxWidth: 560, margin: '40px auto 0' }}>
            <div className="empty-state__icon" aria-hidden="true">
              ✍️
            </div>
            <h3>Sign in to post an event</h3>
            <p>
              Events on Gather are tied to a real account so neighbors know who&rsquo;s hosting.
              It takes about ten seconds.
            </p>
            <div className="empty-state__actions">
              <button type="button" className="btn btn--primary" onClick={openSignup}>
                Create an account
              </button>
              <button type="button" className="btn btn--ghost" onClick={openLogin}>
                Log in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isEdit && loadingEvent) {
    return (
      <div className="form-page">
        <div className="shell">
          <p className="map-note">Loading your event…</p>
        </div>
      </div>
    );
  }

  if (isEdit && loadError) {
    return (
      <div className="form-page">
        <div className="shell">
          <div className="empty-state" style={{ maxWidth: 560, margin: '40px auto 0' }}>
            <div className="empty-state__icon" aria-hidden="true">
              🚫
            </div>
            <h3>Can&rsquo;t edit this event</h3>
            <p>{loadError}</p>
            <div className="empty-state__actions">
              <Link to="/profile" className="btn btn--primary">
                Back to your profile
              </Link>
              <Link to="/" className="btn btn--ghost">
                Browse events
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-page">
      <div className="shell">
        <header className="form-page__head">
          <h1>{isEdit ? 'Edit your event' : 'Post a new event'}</h1>
          <p>
            {isEdit
              ? 'Changes go live for everyone immediately.'
              : 'Anything happening in your neighborhood: a show, a swap, a class, a protest, a dinner. It syncs to the board the moment you publish.'}
          </p>
        </header>

        <form className="form-card" onSubmit={handleSubmit} noValidate>
          <Field id="event-title" label="Event title" error={errors.title}>
            <input
              id="event-title"
              className="input"
              type="text"
              placeholder="e.g. Eastside vinyl swap + listening party"
              value={form.title}
              onChange={update('title')}
              maxLength={120}
              autoComplete="off"
            />
          </Field>

          <div className="form-grid">
            <Field id="event-category" label="Category" error={errors.category}>
              <select
                id="event-category"
                className="select"
                value={form.category}
                onChange={update('category')}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="event-price"
              label="Price"
              hint="Free, $10, donation, pay-what-you-can…"
            >
              <input
                id="event-price"
                className="input"
                type="text"
                value={form.price}
                onChange={update('price')}
                placeholder="Free"
                maxLength={40}
              />
            </Field>
          </div>

          <div className="form-grid form-grid--three">
            <Field id="event-date" label="Date" error={errors.date}>
              <input
                id="event-date"
                className="input"
                type="date"
                value={form.date}
                onChange={update('date')}
              />
            </Field>

            <Field id="event-time" label="Starts" error={errors.time}>
              <input
                id="event-time"
                className="input"
                type="time"
                value={form.time}
                onChange={update('time')}
              />
            </Field>

            <Field id="event-endTime" label="Ends (optional)" error={errors.endTime}>
              <input
                id="event-endTime"
                className="input"
                type="time"
                value={form.endTime}
                onChange={update('endTime')}
              />
            </Field>
          </div>

          <div className="form-grid">
            <Field id="event-neighborhood" label="Neighborhood" error={errors.neighborhood}>
              <select
                id="event-neighborhood"
                className="select"
                value={form.neighborhood}
                onChange={update('neighborhood')}
              >
                <option value="">Pick a neighborhood…</option>
                {NEIGHBORHOOD_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="event-address"
              label="Venue / address"
              error={errors.address}
              hint="Street address, park, or “DM for address”."
            >
              <input
                id="event-address"
                className="input"
                type="text"
                placeholder="e.g. 1200 E 6th St"
                value={form.address}
                onChange={update('address')}
                maxLength={160}
              />
            </Field>
          </div>

          <div className="form-grid">
            <Field
              id="event-capacity"
              label="Capacity (optional)"
              error={errors.capacity}
              hint="We'll show how many spots are left."
            >
              <input
                id="event-capacity"
                className="input"
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 60"
                value={form.capacity}
                onChange={update('capacity')}
              />
            </Field>

            <Field
              id="event-rsvpUrl"
              label="External RSVP / ticket link (optional)"
              error={errors.rsvpUrl}
              hint="For paid or capped events hosted elsewhere."
            >
              <input
                id="event-rsvpUrl"
                className="input"
                type="url"
                placeholder="https://…"
                value={form.rsvpUrl}
                onChange={update('rsvpUrl')}
              />
            </Field>
          </div>

          <Field
            id="event-tags"
            label="Tags (optional)"
            error={errors.tags}
            hint={`Comma separated, up to ${MAX_TAGS}. e.g. vinyl, BYOB, all ages`}
          >
            <input
              id="event-tags"
              className="input"
              type="text"
              placeholder="byob, all ages, outdoors"
              value={form.tags}
              onChange={update('tags')}
            />
          </Field>

          <Field id="event-imageUrl" label="Cover image" error={errors.imageUrl}>
            <div className="upload-row" style={{ marginBottom: 8 }}>
              <label className="file-btn">
                {uploading ? 'Uploading…' : 'Upload image'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageFile}
                  disabled={uploading}
                  style={{ display: 'none' }}
                />
              </label>
              <span className="field__hint" style={{ margin: 0 }}>
                PNG/JPG up to 5 MB, or paste a URL below.
              </span>
            </div>
            <input
              id="event-imageUrl"
              className="input"
              type="url"
              placeholder="https://…"
              value={form.imageUrl}
              onChange={update('imageUrl')}
              style={{ marginBottom: 8 }}
            />
            <div
              className="image-preview"
              style={form.imageUrl ? { backgroundImage: `url(${form.imageUrl})` } : undefined}
              aria-hidden="true"
            >
              {!form.imageUrl && 'Image preview'}
            </div>
          </Field>

          <Field
            id="event-description"
            label="Description"
            error={errors.description}
            hint="What is it, who's it for, and what should people bring?"
          >
            <textarea
              id="event-description"
              className="textarea"
              rows={6}
              placeholder="A backyard listening session for local DJs and record collectors. Bring a record to swap, a chair, and something to drink…"
              value={form.description}
              onChange={update('description')}
              maxLength={4000}
            />
          </Field>

          {submitError && (
            <div className="alert alert--error" role="alert">
              {submitError}
            </div>
          )}

          <div className="form-note">
            By publishing you confirm this is a real event you&rsquo;re involved in. Gather removes
            spam and commercial listings that aren&rsquo;t rooted in the neighborhood.
          </div>

          <div className="form-actions">
            <Link to={isEdit ? `/event/${editId}` : '/'} className="btn btn--ghost">
              Cancel
            </Link>
            <button type="submit" className="btn btn--primary" disabled={submitting || uploading}>
              {submitting
                ? isEdit
                  ? 'Saving…'
                  : 'Publishing…'
                : isEdit
                  ? 'Save changes'
                  : 'Publish event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PostEventPage;
