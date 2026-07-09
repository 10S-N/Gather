import { useAuth } from '../contexts/useAuth';
import { Link } from 'react-router-dom';
import { useState } from 'react';

const mockConversations = [
  {
    id: 'conv-1',
    name: 'UT Design Showcase Organizers',
    avatar: '🎓',
    preview: 'Reminder: Doors open at 6:30 PM on Thursday.',
    time: '2m ago',
    unread: 2,
    messages: [
      { from: 'them', text: 'Hi! Thanks for RSVP-ing to the showcase.', time: 'Yesterday' },
      { from: 'me', text: 'Excited to attend! Any parking tips?', time: 'Yesterday' },
      { from: 'them', text: 'Reminder: Doors open at 6:30 PM on Thursday.', time: '2m ago' },
    ],
  },
  {
    id: 'conv-2',
    name: 'Boggy Creek Cleanup',
    avatar: '🌿',
    preview: 'Bring a reusable water bottle if you can!',
    time: '1h ago',
    unread: 0,
    messages: [
      { from: 'them', text: 'Welcome to the volunteer team!', time: 'Mon' },
      { from: 'me', text: 'Should I bring gloves?', time: 'Mon' },
      { from: 'them', text: 'Bring a reusable water bottle if you can!', time: '1h ago' },
    ],
  },
  {
    id: 'conv-3',
    name: 'Open Mic Night Host',
    avatar: '🎤',
    preview: 'You’re confirmed for the 8pm slot.',
    time: 'Yesterday',
    unread: 0,
    messages: [
      { from: 'me', text: 'I’d like to sign up for a slot.', time: 'Tue' },
      { from: 'them', text: 'You’re confirmed for the 8pm slot.', time: 'Yesterday' },
    ],
  },
  {
    id: 'conv-4',
    name: 'Farmers Market Coordinator',
    avatar: '🥕',
    preview: 'Vendor map attached for Saturday.',
    time: '3d ago',
    unread: 0,
    messages: [
      { from: 'them', text: 'Vendor map attached for Saturday.', time: '3d ago' },
    ],
  },
];

function MessagesPage() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState(mockConversations[0].id);
  const active = mockConversations.find((c) => c.id === activeId) || mockConversations[0];

  if (!user) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
        <h2>Sign in to view messages</h2>
        <p style={{ color: 'var(--earth)', marginTop: '0.5rem' }}>
          Conversations with event organizers and attendees will appear here once you log in.
        </p>
        <Link to="/">
          <button style={primaryBtnStyle}>Browse Events</button>
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        height: 'calc(100vh - 60px)',
        backgroundColor: 'white',
      }}
    >
      {/* LEFT: Conversation List */}
      <aside
        style={{
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
          backgroundColor: 'var(--sand)',
        }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, color: 'var(--navy)' }}>Messages</h2>
          <p style={{ fontSize: '13px', color: 'var(--earth)', margin: '4px 0 0' }}>
            {mockConversations.length} conversations
          </p>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {mockConversations.map((conv) => {
            const isActive = conv.id === activeId;
            return (
              <li
                key={conv.id}
                onClick={() => setActiveId(conv.id)}
                style={{
                  padding: '14px 1.5rem',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  backgroundColor: isActive ? 'white' : 'transparent',
                  borderLeft: isActive ? '4px solid var(--rust)' : '4px solid transparent',
                  transition: 'background-color 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ fontSize: '22px' }}>{conv.avatar}</span>
                    <strong style={{ color: 'var(--navy)', fontSize: '15px' }}>{conv.name}</strong>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--earth)' }}>{conv.time}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '4px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      color: 'var(--earth)',
                      maxWidth: '210px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {conv.preview}
                  </span>
                  {conv.unread > 0 && (
                    <span
                      style={{
                        backgroundColor: 'var(--rust)',
                        color: 'white',
                        borderRadius: '12px',
                        padding: '2px 8px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                      }}
                    >
                      {conv.unread}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* RIGHT: Active Conversation */}
      <main style={{ display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            padding: '1.25rem 2rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, color: 'var(--navy)' }}>
              {active.avatar} {active.name}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--earth)', margin: '4px 0 0' }}>
              Event thread • 3 participants
            </p>
          </div>
          <button style={secondaryBtnStyle}>View Event</button>
        </header>

        <div
          style={{
            flex: 1,
            padding: '1.5rem 2rem',
            backgroundColor: '#fcfbfa',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {active.messages.map((msg, i) => (
            <div
              key={i}
              style={{
                alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start',
                maxWidth: '70%',
                padding: '10px 14px',
                borderRadius: '14px',
                backgroundColor: msg.from === 'me' ? 'var(--navy)' : 'white',
                color: msg.from === 'me' ? 'white' : 'var(--text)',
                border: msg.from === 'me' ? 'none' : '1px solid var(--border)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
              }}
            >
              <p style={{ margin: 0 }}>{msg.text}</p>
              <span
                style={{
                  fontSize: '11px',
                  opacity: 0.7,
                  display: 'block',
                  marginTop: '4px',
                }}
              >
                {msg.time}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: '1rem 2rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: '10px',
          }}
        >
          <input
            type="text"
            placeholder="Type a message…"
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '24px',
              border: '1px solid var(--border)',
              fontSize: '15px',
              outline: 'none',
            }}
          />
          <button style={primaryBtnStyle}>Send</button>
        </div>
      </main>
    </div>
  );
}

const primaryBtnStyle = {
  backgroundColor: 'var(--rust)',
  color: 'white',
  border: 'none',
  padding: '10px 18px',
  borderRadius: '8px',
  fontWeight: 'bold',
  cursor: 'pointer',
};

const secondaryBtnStyle = {
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--earth)',
  padding: '8px 14px',
  borderRadius: '8px',
  fontWeight: '500',
  cursor: 'pointer',
};

export default MessagesPage;
