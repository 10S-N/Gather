import { useState } from 'react';
import { useAuth } from '../contexts/useAuth';
import { useNavigate } from 'react-router-dom';

const initialForm = {
  title: '',
  category: 'Community',
  date: '',
  time: '',
  location: '',
  price: 'Free',
  capacity: '',
  description: '',
  imageUrl: '',
};

function PostEventPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(null);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (!form.title.trim()) next.title = 'Title is required';
    if (!form.date) next.date = 'Pick a date';
    if (!form.time) next.time = 'Pick a time';
    if (!form.location.trim()) next.location = 'Add a venue or address';
    if (form.capacity && Number(form.capacity) <= 0) next.capacity = 'Must be positive';
    if (!form.description.trim()) next.description = 'Add a short description';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    // In production this would call Firestore addDoc('events', form)
    setSubmitted({ ...form, host: user?.displayName || user?.email || 'You' });
  };

  const handlePostAnother = () => {
    setForm(initialForm);
    setSubmitted(null);
  };

  // Auth gate
  if (!user) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
        <h2>Sign in to post an event</h2>
        <p style={{ color: 'var(--earth)', margin: '0.5rem 0 1.25rem' }}>
          Only logged-in hosts can publish events on Gather.
        </p>
        <button style={primaryBtnStyle} onClick={() => navigate('/')}>
          Go back home
        </button>
      </div>
    );
  }

  // Success view
  if (submitted) {
    return (
      <div
        style={{
          maxWidth: '600px',
          margin: '3rem auto',
          padding: '2rem',
          textAlign: 'center',
          backgroundColor: 'white',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ fontSize: '48px' }}>🎉</div>
        <h2 style={{ marginTop: '0.5rem' }}>Event submitted for review</h2>
        <p style={{ color: 'var(--earth)' }}>
          <strong>{submitted.title}</strong> will appear on the board once it’s approved.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '1.25rem' }}>
          <button style={secondaryBtnStyle} onClick={handlePostAnother}>
            Post another
          </button>
          <button style={primaryBtnStyle} onClick={() => navigate('/')}>
            Back to events
          </button>
        </div>
      </div>
    );
  }

  // Form view
  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 4px 0' }}>Post a New Event</h1>
        <p style={{ color: 'var(--earth)', margin: 0 }}>
          Tell Austinites what’s happening. Fields marked with * are required.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: 'white',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
        }}
      >
        <FieldGroup label="Title *" error={errors.title}>
          <input
            type="text"
            placeholder="e.g. Eastside Sunset Yoga"
            value={form.title}
            onChange={update('title')}
            style={inputStyle}
          />
        </FieldGroup>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <FieldGroup label="Category *" error={errors.category}>
            <select value={form.category} onChange={update('category')} style={inputStyle}>
              <option>Academic</option>
              <option>Community</option>
              <option>Entertainment</option>
              <option>Social</option>
            </select>
          </FieldGroup>

          <FieldGroup label="Price *">
            <select value={form.price} onChange={update('price')} style={inputStyle}>
              <option value="Free">Free</option>
              <option value="$5">$5</option>
              <option value="$10">$10</option>
              <option value="$15">$15</option>
              <option value="$25">$25</option>
            </select>
          </FieldGroup>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <FieldGroup label="Date *" error={errors.date}>
            <input type="date" value={form.date} onChange={update('date')} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label="Time *" error={errors.time}>
            <input type="time" value={form.time} onChange={update('time')} style={inputStyle} />
          </FieldGroup>
        </div>

        <FieldGroup label="Location *" error={errors.location}>
          <input
            type="text"
            placeholder="e.g. Zilker Park, Austin TX"
            value={form.location}
            onChange={update('location')}
            style={inputStyle}
          />
        </FieldGroup>

        <FieldGroup label="Capacity (optional)" error={errors.capacity}>
          <input
            type="number"
            min="1"
            placeholder="e.g. 50"
            value={form.capacity}
            onChange={update('capacity')}
            style={inputStyle}
          />
        </FieldGroup>

        <FieldGroup label="Cover image URL (optional)">
          <input
            type="url"
            placeholder="https://..."
            value={form.imageUrl}
            onChange={update('imageUrl')}
            style={inputStyle}
          />
        </FieldGroup>

        <FieldGroup label="Description *" error={errors.description}>
          <textarea
            rows={5}
            placeholder="What should attendees expect? Anything they should bring?"
            value={form.description}
            onChange={update('description')}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </FieldGroup>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={() => navigate('/')} style={secondaryBtnStyle}>
            Cancel
          </button>
          <button type="submit" style={primaryBtnStyle}>
            Publish event
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldGroup({ label, error, children }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
      {error && (
        <span style={{ color: '#a0322b', fontSize: '12px', marginTop: '4px', display: 'block' }}>
          {error}
        </span>
      )}
    </div>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: '600',
  color: 'var(--earth)',
  marginBottom: '6px',
  letterSpacing: '0.3px',
};

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  fontSize: '15px',
  backgroundColor: '#fcfbfa',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtnStyle = {
  backgroundColor: 'var(--rust)',
  color: 'white',
  border: 'none',
  padding: '11px 20px',
  borderRadius: '8px',
  fontWeight: 'bold',
  cursor: 'pointer',
};

const secondaryBtnStyle = {
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--earth)',
  padding: '10px 18px',
  borderRadius: '8px',
  fontWeight: '500',
  cursor: 'pointer',
};

export default PostEventPage;
